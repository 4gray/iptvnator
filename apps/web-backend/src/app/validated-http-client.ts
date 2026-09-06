import { ProviderAxiosTransport } from './provider-axios-transport';
import {
    discardProviderBody,
    discardProviderErrorBody,
    readProviderBody,
} from './provider-response';
import axios, { AxiosRequestConfig } from 'axios';
import { Agent as HttpAgent, ClientRequest } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import { ProviderRequestError } from './provider-request-error';
import { ProviderUrlPolicy, validateProviderUrl } from './provider-url-policy';

export interface WebBackendHttpGetOptions {
    readonly headers?: Record<string, string>;
    readonly params?: Record<string, string>;
    readonly responseType?: 'arraybuffer';
    readonly timeout?: number;
    readonly signal?: AbortSignal;
}

export type ProviderTransportOptions = Omit<
    WebBackendHttpGetOptions,
    'responseType'
> &
    Pick<
        AxiosRequestConfig,
        | 'responseType'
        | 'maxRedirects'
        | 'validateStatus'
        | 'httpAgent'
        | 'httpsAgent'
        | 'proxy'
        | 'adapter'
    >;

export interface WebBackendHttpResponse<T> {
    readonly data: T;
    readonly status: number;
    readonly statusText?: string;
    readonly request?: ClientRequest;
    readonly headers: { readonly location?: string };
}

/** Injected transports must honor the same options and status contract as axios. */
export interface WebBackendHttpClient {
    get<T>(
        url: string,
        options?: ProviderTransportOptions
    ): Promise<WebBackendHttpResponse<T>>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
    'sn',
]);

export class ValidatedHttpClient implements WebBackendHttpClient {
    constructor(
        private readonly policy: ProviderUrlPolicy,
        private readonly transport: WebBackendHttpClient = new ProviderAxiosTransport()
    ) {}

    async get<T>(
        rawUrl: string,
        options: WebBackendHttpGetOptions = {}
    ): Promise<WebBackendHttpResponse<T>> {
        let currentUrl = rawUrl;
        let params = options.params;
        let headers = options.headers;
        let initialResponded = false;
        const visited = new Set<string>();
        try {
            for (let redirects = 0; ; redirects++) {
                options.signal?.throwIfAborted();
                const target = await validateProviderUrl(
                    currentUrl,
                    this.policy
                );
                options.signal?.throwIfAborted();
                if ('message' in target) {
                    throw new ProviderRequestError(
                        initialResponded,
                        target.lookupError,
                        target
                    );
                }
                // Match axios serialization once. Location is resolved against
                // the URL actually sent; original params are never replayed.
                const sentUrl = new URL(
                    axios.getUri({ url: target.url.href, params })
                );
                sentUrl.hash = '';
                if (visited.has(sentUrl.href))
                    throw redirectError('Redirect cycle detected');
                visited.add(sentUrl.href);
                const lookup = pinnedLookup(target.addresses);
                // Fresh agents prevent socket-pool reuse across validations.
                // Empty proxyEnv also disables Node's native env proxy support.
                const agentOptions = { lookup, proxyEnv: {} };
                const httpAgent = new HttpAgent(agentOptions);
                const httpsAgent = new HttpsAgent(agentOptions);
                let response: WebBackendHttpResponse<T>;
                try {
                    response = await this.transport.get<T>(target.url.href, {
                        ...options,
                        headers,
                        params,
                        adapter: 'http',
                        proxy: false,
                        maxRedirects: 0,
                        responseType: 'stream',
                        httpAgent,
                        httpsAgent,
                        validateStatus: (status) =>
                            REDIRECT_STATUSES.has(status) ||
                            (status >= 200 && status < 300),
                    });
                    if (!REDIRECT_STATUSES.has(response.status)) {
                        try {
                            return {
                                ...response,
                                data: await readProviderBody(
                                    response.data,
                                    options.responseType === 'arraybuffer',
                                    options.timeout,
                                    response.request?.socket ?? undefined
                                ),
                            };
                        } catch (error) {
                            if (axios.isCancel(error)) throw error;
                            // A broken/stalled body still proves the endpoint
                            // answered. Preserve buffered axios error semantics.
                            throw Object.assign(
                                new Error('Provider response body failed'),
                                {
                                    cause: error,
                                    response: {
                                        status: response.status,
                                        statusText: response.statusText,
                                    },
                                }
                            );
                        }
                    }
                    initialResponded = true;
                    discardProviderBody(response.data);
                } catch (error) {
                    discardProviderErrorBody(error);
                    throw error;
                } finally {
                    httpAgent.destroy();
                    httpsAgent.destroy();
                }
                if (redirects >= 5) throw redirectError('Too many redirects');
                const location = response.headers.location;
                if (!location)
                    throw redirectError(
                        'Redirect response did not include a location'
                    );
                let nextUrl: URL;
                try {
                    nextUrl = new URL(location, sentUrl);
                } catch {
                    throw redirectError('Redirect location is not a valid URL');
                }
                if (nextUrl.origin !== sentUrl.origin) {
                    headers = Object.fromEntries(
                        Object.entries(headers ?? {}).filter(
                            ([name]) =>
                                !SENSITIVE_HEADERS.has(name.toLowerCase()) &&
                                name.toLowerCase() !== 'host'
                        )
                    );
                }
                params = undefined;
                currentUrl = nextUrl.href;
            }
        } catch (error) {
            if (error instanceof ProviderRequestError) throw error;
            throw new ProviderRequestError(initialResponded, error);
        }
    }
}

function redirectError(message: string): ProviderRequestError {
    return new ProviderRequestError(true, undefined, { message, status: 502 });
}

function pinnedLookup(addresses: readonly string[]): LookupFunction {
    const records = addresses.map((address) => ({
        address,
        family: isIP(address),
    }));
    return (_hostname, options, callback) => {
        const eligible = options.family
            ? records.filter((record) => record.family === options.family)
            : records;
        if (!eligible.length) {
            callback(
                Object.assign(
                    new Error('No validated address for the requested family'),
                    { code: 'ENOTFOUND' }
                ),
                []
            );
        } else if (options.all) {
            callback(null, eligible);
        } else {
            callback(null, eligible[0].address, eligible[0].family);
        }
    };
}
