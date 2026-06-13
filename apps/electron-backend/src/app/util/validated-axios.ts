import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    RawAxiosRequestHeaders,
} from 'axios';
import type { LookupAddress } from 'node:dns';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import {
    RemoteUrlPolicy,
    UnsafeUrlError,
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

export type ValidatedAxiosRequestConfig = Omit<
    AxiosRequestConfig,
    'httpAgent' | 'httpsAgent'
> & {
    agentFactory?: ValidatedRequestAgentFactory;
};

function copyHeadersWithoutSensitiveValues(
    headers: AxiosRequestConfig['headers']
): AxiosRequestConfig['headers'] {
    if (!headers) {
        return headers;
    }

    const source =
        typeof (headers as { toJSON?: () => RawAxiosRequestHeaders }).toJSON ===
        'function'
            ? (
                  headers as {
                      toJSON: () => RawAxiosRequestHeaders;
                  }
              ).toJSON()
            : headers;
    const sanitized: RawAxiosRequestHeaders = {};

    for (const [name, value] of Object.entries(source)) {
        if (!SENSITIVE_HEADERS.has(name.toLowerCase())) {
            sanitized[name] = value;
        }
    }

    return sanitized;
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
    const { agentFactory, ...axiosConfig } = config;
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

    for (let redirectCount = 0; ; redirectCount += 1) {
        const validatedTarget = await validateRemoteUrl(currentUrl, policy);
        const validatedUrl = validatedTarget.url;
        const pinnedConfig = pinRequestToValidatedAddresses(
            requestConfig,
            validatedUrl,
            validatedTarget.addresses
        );
        const response = await axios<T>({
            ...pinnedConfig,
            maxRedirects: 0,
            url: validatedUrl.toString(),
            validateStatus: (status) =>
                REDIRECT_STATUSES.has(status) || originalValidateStatus(status),
        });

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
        const method = requestConfig.method?.toUpperCase();
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

        currentUrl = nextUrl.toString();
    }
}
