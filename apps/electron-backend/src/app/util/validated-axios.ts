import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    RawAxiosRequestHeaders,
} from 'axios';
import { Readable } from 'node:stream';
import type { LookupAddress } from 'node:dns';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import { observeAgentSocketConnections } from '@iptvnator/shared/host-health';
import { getProxyForUrl } from 'proxy-from-env';
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
    onResponse?: () => void;
    /**
     * Called once a hop's TCP connection is established (or a pooled, already
     * connected socket was handed to it). Lets the host connectivity guard
     * tell a panel that never accepted the connection from one that accepted
     * it and then went silent. Requesting it gives the request its own agent
     * instead of the shared keep-alive `globalAgent`, since the observer is
     * per request and must never be installed on a shared agent. Not honoured
     * while an environment proxy applies to the URL: the socket would be the
     * proxy's, and its handshake proves nothing about the portal.
     */
    onConnect?: () => void;
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
 * Whether axios would route `url` through an environment proxy. The very
 * resolution axios' http adapter performs (`proxy-from-env`, the same pinned
 * package): `<protocol>_proxy` / `all_proxy` in either case with the same
 * lowercase-then-uppercase fallback, and `no_proxy` exemptions honoured — a
 * LAN portal listed there connects directly and keeps its observer.
 */
function environmentProxiesUrl(url: URL): boolean {
    return getProxyForUrl(url.href) !== '';
}

function observeHopConnections(
    config: AxiosRequestConfig,
    url: URL,
    onConnect: (() => void) | undefined
): AxiosRequestConfig {
    if (!onConnect) {
        return config;
    }
    // Unpinned requests keep axios' environment proxy support. Through a
    // proxy the observed socket connects to the proxy, not the portal, and a
    // proxy that accepts TCP but cannot reach the portal would then pass as
    // the portal answering. No observer there: such requests keep reporting
    // their timeouts as host-level, exactly as before the hook existed.
    if (config.proxy !== false && environmentProxiesUrl(url)) {
        return config;
    }

    if (url.protocol === 'https:') {
        return {
            ...config,
            httpsAgent: observeAgentSocketConnections(
                config.httpsAgent ?? new HttpsAgent(),
                onConnect
            ),
        };
    }

    return {
        ...config,
        httpAgent: observeAgentSocketConnections(
            config.httpAgent ?? new HttpAgent(),
            onConnect
        ),
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

/**
 * Runs an Axios request while validating the initial URL and every redirect.
 * Redirects are followed manually so each target passes through the same
 * private-network and protocol policy.
 */
export async function requestWithValidatedRedirects<T = unknown>(
    rawUrl: string,
    { onResponse, onConnect, ...config }: ValidatedAxiosRequestConfig = {},
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

    for (let redirectCount = 0; ; redirectCount += 1) {
        const validatedTarget = await validateRemoteUrl(
            currentUrl,
            getRedirectValidationPolicy(currentUrl, initialOrigin, policy)
        );
        const validatedUrl = validatedTarget.url;
        const isInitialRequest = !initialOrigin;
        if (isInitialRequest) {
            initialOrigin = validatedUrl.origin;
            initialAddresses = validatedTarget.addresses;
        }
        const addresses =
            !isInitialRequest &&
            policy.allowPrivateNetworks &&
            policy.allowPrivateNetworkRedirects === false &&
            validatedUrl.origin === initialOrigin
                ? initialAddresses
                : validatedTarget.addresses;
        const pinnedConfig = observeHopConnections(
            pinRequestToValidatedAddresses(
                requestConfig,
                validatedUrl,
                addresses
            ),
            validatedUrl,
            onConnect
        );
        const response = await axios<T>({
            ...pinnedConfig,
            maxRedirects: 0,
            url: validatedUrl.toString(),
            validateStatus: (status) =>
                REDIRECT_STATUSES.has(status) || originalValidateStatus(status),
        });

        onResponse?.();
        if (!REDIRECT_STATUSES.has(response.status)) {
            return response;
        }

        // No consumer owns intermediate bodies, including redirects rejected below.
        if (response.data instanceof Readable) response.data.destroy();

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
        // Credentials are scoped to the host, not the origin: IPTV portals
        // routinely redirect between schemes and ports of the same host
        // (http -> https upgrades, port moves), and stripping the session
        // cookie/token there breaks the portal outright (#1158). Two hops do
        // lose Authorization/Cookie/basic auth/params: a *different* host
        // (credentials never leak to third parties) and a same-host
        // https -> http downgrade (a session obtained over TLS is never
        // replayed in cleartext).
        const isCredentialUnsafeRedirect =
            nextUrl.hostname !== validatedUrl.hostname ||
            (validatedUrl.protocol === 'https:' &&
                nextUrl.protocol === 'http:');
        if (isCredentialUnsafeRedirect) {
            if (requestConfig.data !== undefined) {
                throw new UnsafeUrlError(
                    'Redirects that change the host or downgrade to HTTP cannot replay request bodies',
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
