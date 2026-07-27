import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    RawAxiosRequestHeaders,
    RawAxiosResponseHeaders,
} from 'axios';
import type { LookupAddress } from 'node:dns';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import {
    RemoteUrlPolicy,
    UnsafeUrlError,
    ValidatedRemoteUrl,
    validateRemoteUrl,
} from '../events/url-safety';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
]);

export interface ValidatedRequestAgentFactory {
    createHttpAgent?(lookup?: LookupFunction): HttpAgent;
    createHttpsAgent?(lookup?: LookupFunction, url?: URL): HttpsAgent;
}

export interface ValidatedAxiosPrepareHeadersContext {
    readonly headers: RawAxiosRequestHeaders;
    readonly method: string;
    readonly url: string;
}

export interface ValidatedAxiosResponseContext {
    readonly headers: RawAxiosResponseHeaders;
    readonly method: string;
    readonly status: number;
    readonly url: string;
}

export interface ValidatedAxiosRedirectContext {
    readonly crossOrigin: boolean;
    readonly fromUrl: string;
    readonly method: string;
    readonly status: number;
    readonly toUrl: string;
}

export interface ValidatedAxiosRedirectHooks {
    beforeValidatedRedirect?(
        redirect: ValidatedAxiosRedirectContext
    ): Promise<void> | void;
    collectResponse?(
        response: ValidatedAxiosResponseContext
    ): Promise<void> | void;
    prepareHeaders?(
        hop: ValidatedAxiosPrepareHeadersContext
    ):
        | AxiosRequestConfig['headers']
        | Promise<AxiosRequestConfig['headers']>;
}

export type ValidatedAxiosRequestConfig = Omit<
    AxiosRequestConfig,
    'httpAgent' | 'httpsAgent'
> & {
    agentFactory?: ValidatedRequestAgentFactory;
    redirectHooks?: ValidatedAxiosRedirectHooks;
};

function copyRequestHeaders(
    headers: AxiosRequestConfig['headers']
): RawAxiosRequestHeaders {
    if (!headers) {
        return {};
    }

    const source =
        typeof (headers as { toJSON?: () => RawAxiosRequestHeaders })
            .toJSON === 'function'
            ? (
                  headers as {
                      toJSON: () => RawAxiosRequestHeaders;
                  }
              ).toJSON()
            : headers;
    return Object.fromEntries(
        Object.entries(source).map(([name, value]) => [
            name,
            Array.isArray(value) ? [...value] : value,
        ])
    );
}

function copyHeadersWithoutSensitiveValues(
    headers: AxiosRequestConfig['headers']
): AxiosRequestConfig['headers'] {
    if (!headers) {
        return headers;
    }

    const source = copyRequestHeaders(headers);
    const sanitized: RawAxiosRequestHeaders = {};

    for (const [name, value] of Object.entries(source)) {
        if (!SENSITIVE_HEADERS.has(name.toLowerCase())) {
            sanitized[name] = value;
        }
    }

    return sanitized;
}

function copyResponseHeaders(
    headers: AxiosResponse['headers']
): RawAxiosResponseHeaders {
    const source =
        typeof headers.toJSON === 'function' ? headers.toJSON() : headers;
    return Object.fromEntries(
        Object.entries(source).map(([name, value]) => [
            name,
            Array.isArray(value) ? [...value] : value,
        ])
    );
}

function createPinnedLookup(addresses: readonly string[]): LookupFunction {
    const records: LookupAddress[] = addresses.map((address) => ({
        address,
        family: isIP(address),
    }));

    return (_hostname, options, callback) => {
        const requestedFamily = options.family;
        const eligibleRecords = requestedFamily
            ? records.filter((record) => record.family === requestedFamily)
            : records;

        if (eligibleRecords.length === 0) {
            const error = new Error(
                'Validated URL has no connectable address'
            ) as NodeJS.ErrnoException;
            error.code = 'ENOTFOUND';
            callback(error, []);
            return;
        }

        if (options.all) {
            callback(null, eligibleRecords);
            return;
        }

        const selected = eligibleRecords[0];
        callback(null, selected.address, selected.family);
    };
}

function pinRequestToValidatedAddresses(
    config: ValidatedAxiosRequestConfig,
    url: URL,
    addresses: readonly string[] | undefined
): AxiosRequestConfig {
    const {
        agentFactory,
        redirectHooks: _redirectHooks,
        ...axiosConfig
    } = config;
    if (!addresses) {
        if (url.protocol === 'https:' && agentFactory?.createHttpsAgent) {
            return {
                ...axiosConfig,
                httpsAgent: agentFactory.createHttpsAgent(undefined, url),
            };
        }
        if (url.protocol === 'http:' && agentFactory?.createHttpAgent) {
            return {
                ...axiosConfig,
                httpAgent: agentFactory.createHttpAgent(),
            };
        }
        return axiosConfig;
    }

    const lookup = createPinnedLookup(addresses);
    if (url.protocol === 'https:') {
        return {
            ...axiosConfig,
            httpsAgent:
                agentFactory?.createHttpsAgent?.(lookup, url) ??
                new HttpsAgent({ lookup }),
            proxy: false,
        };
    }

    return {
        ...axiosConfig,
        httpAgent:
            agentFactory?.createHttpAgent?.(lookup) ??
            new HttpAgent({ lookup }),
        proxy: false,
    };
}

function getRedirectValidationPolicy(
    currentUrl: string,
    initialOrigin: string | undefined,
    policy: RemoteUrlPolicy
): RemoteUrlPolicy {
    if (
        !initialOrigin ||
        !policy.allowPrivateNetworks ||
        policy.allowPrivateNetworkRedirects !== false
    ) {
        return policy;
    }

    const parsedUrl = new URL(currentUrl);
    if (parsedUrl.origin === initialOrigin) {
        return {
            ...policy,
            pinAllowedPrivateNetworkHosts: false,
        };
    }

    return {
        ...policy,
        allowPrivateNetworks: false,
    };
}

function effectiveRequestMethod(method: string | undefined): string {
    return method?.toUpperCase() || 'GET';
}

function canonicalVisitedTarget(url: URL, method: string): string {
    const canonicalUrl = new URL(url);
    canonicalUrl.hash = '';
    return `${method} ${canonicalUrl.toString()}`;
}

function rememberValidatedTarget(
    visitedTargets: Set<string>,
    target: URL,
    method: string
): void {
    const key = canonicalVisitedTarget(target, method);
    if (visitedTargets.has(key)) {
        throw new UnsafeUrlError('Redirect loop detected', 502);
    }
    visitedTargets.add(key);
}

async function prepareHopConfig(
    config: ValidatedAxiosRequestConfig,
    validatedUrl: URL,
    method: string
): Promise<ValidatedAxiosRequestConfig> {
    const prepareHeaders = config.redirectHooks?.prepareHeaders;
    if (!prepareHeaders) {
        return config;
    }

    const headers = await prepareHeaders({
        headers: copyRequestHeaders(config.headers),
        method,
        url: validatedUrl.toString(),
    });
    return {
        ...config,
        headers,
    };
}

async function collectHopResponse(
    hooks: ValidatedAxiosRedirectHooks | undefined,
    response: AxiosResponse<unknown>,
    validatedUrl: URL,
    method: string
): Promise<void> {
    await hooks?.collectResponse?.({
        headers: copyResponseHeaders(response.headers),
        method,
        status: response.status,
        url: validatedUrl.toString(),
    });
}

function rejectedAxiosResponse(
    error: unknown
): AxiosResponse<unknown> | undefined {
    if (
        typeof error !== 'object' ||
        error === null ||
        !('response' in error)
    ) {
        return undefined;
    }

    const response = error.response;
    if (
        typeof response !== 'object' ||
        response === null ||
        typeof Reflect.get(response, 'status') !== 'number' ||
        typeof Reflect.get(response, 'headers') !== 'object' ||
        Reflect.get(response, 'headers') === null
    ) {
        return undefined;
    }
    return response as AxiosResponse<unknown>;
}

/**
 * Runs an Axios request while validating the initial URL and every redirect.
 * Redirects are followed manually so each target passes through the same
 * private-network and protocol policy.
 */
export async function requestWithValidatedRedirects<T = unknown>(
    rawUrl: string,
    config: ValidatedAxiosRequestConfig = {},
    policy: RemoteUrlPolicy = {},
    maxRedirects = 5
): Promise<AxiosResponse<T>> {
    const originalValidateStatus =
        config.validateStatus ??
        ((status: number) => status >= 200 && status < 300);
    let currentUrl = rawUrl;
    let requestConfig = { ...config };
    let initialOrigin: string | undefined;
    let initialAddresses: readonly string[] | undefined;
    let pendingValidatedTarget: ValidatedRemoteUrl | undefined;
    const visitedTargets = new Set<string>();

    for (let redirectCount = 0; ; redirectCount += 1) {
        const validatedTarget =
            pendingValidatedTarget ??
            (await validateRemoteUrl(
                currentUrl,
                getRedirectValidationPolicy(currentUrl, initialOrigin, policy)
            ));
        pendingValidatedTarget = undefined;
        const validatedUrl = validatedTarget.url;
        const isInitialRequest = !initialOrigin;
        if (isInitialRequest) {
            initialOrigin = validatedUrl.origin;
            initialAddresses = validatedTarget.addresses;
            rememberValidatedTarget(
                visitedTargets,
                validatedUrl,
                effectiveRequestMethod(requestConfig.method)
            );
        }
        const addresses =
            !isInitialRequest &&
            policy.allowPrivateNetworks &&
            policy.allowPrivateNetworkRedirects === false &&
            validatedUrl.origin === initialOrigin
                ? initialAddresses
                : validatedTarget.addresses;
        const method = effectiveRequestMethod(requestConfig.method);
        const hopConfig = await prepareHopConfig(
            requestConfig,
            validatedUrl,
            method
        );
        const pinnedConfig = pinRequestToValidatedAddresses(
            hopConfig,
            validatedUrl,
            addresses
        );
        let response: AxiosResponse<T>;
        try {
            response = await axios<T>({
                ...pinnedConfig,
                maxRedirects: 0,
                url: validatedUrl.toString(),
                validateStatus: (status) =>
                    REDIRECT_STATUSES.has(status) ||
                    originalValidateStatus(status),
            });
        } catch (error) {
            const rejectedResponse = rejectedAxiosResponse(error);
            if (rejectedResponse) {
                await collectHopResponse(
                    requestConfig.redirectHooks,
                    rejectedResponse,
                    validatedUrl,
                    method
                );
            }
            throw error;
        }
        await collectHopResponse(
            requestConfig.redirectHooks,
            response,
            validatedUrl,
            method
        );

        if (!REDIRECT_STATUSES.has(response.status)) {
            return response;
        }

        const location = response.headers?.location;
        if (!location) {
            throw new UnsafeUrlError(
                'Redirect response did not include a location',
                502
            );
        }
        if (redirectCount >= maxRedirects) {
            throw new UnsafeUrlError('Too many redirects', 502);
        }

        const nextUrl = new URL(location, validatedUrl);
        const shouldRewriteToGet =
            (response.status === 303 && method !== 'HEAD') ||
            ((response.status === 301 || response.status === 302) &&
                method === 'POST');
        if (shouldRewriteToGet) {
            requestConfig = {
                ...requestConfig,
                data: undefined,
                method: 'GET',
            };
        }
        if (nextUrl.origin !== validatedUrl.origin) {
            if (requestConfig.data !== undefined) {
                throw new UnsafeUrlError(
                    'Cross-origin redirects with request bodies are not supported',
                    502
                );
            }
            requestConfig = {
                ...requestConfig,
                auth: undefined,
                headers: copyHeadersWithoutSensitiveValues(
                    requestConfig.headers
                ),
                params: undefined,
            };
        }

        const nextMethod = effectiveRequestMethod(requestConfig.method);
        const nextTarget = await validateRemoteUrl(
            nextUrl.toString(),
            getRedirectValidationPolicy(
                nextUrl.toString(),
                initialOrigin,
                policy
            )
        );
        rememberValidatedTarget(visitedTargets, nextTarget.url, nextMethod);
        await requestConfig.redirectHooks?.beforeValidatedRedirect?.({
            crossOrigin: nextTarget.url.origin !== validatedUrl.origin,
            fromUrl: validatedUrl.toString(),
            method: nextMethod,
            status: response.status,
            toUrl: nextTarget.url.toString(),
        });

        currentUrl = nextTarget.url.toString();
        pendingValidatedTarget = nextTarget;
    }
}
