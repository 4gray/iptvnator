import axios from 'axios';
import {
    request as httpRequest,
    ClientRequest,
    IncomingMessage,
    RequestOptions,
} from 'node:http';
import {
    request as httpsRequest,
    Agent as HttpsAgent,
    AgentOptions,
} from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import type {
    ProviderTransportOptions,
    WebBackendHttpClient,
    WebBackendHttpResponse,
} from './validated-http-client';

/**
 * Keep HTTP authority metadata separate from socket destination selection.
 * Only the hop's pinned agent can select an address; axios receives a fixed
 * logical hostname, never a user-selected connection authority. Host and TLS
 * identity still describe the validated provider, including IP certificates.
 */
export class ProviderAxiosTransport implements WebBackendHttpClient {
    async get<T>(
        url: string,
        options: ProviderTransportOptions = {}
    ): Promise<WebBackendHttpResponse<T>> {
        const target = new URL(axios.getUri({ url, params: options.params }));
        const secure = target.protocol === 'https:';
        const hostname = target.hostname.replace(/^\[|\]$/g, '');
        const port = Number(target.port || (secure ? 443 : 80));
        const root = secure
            ? 'https://provider.invalid/'
            : 'http://provider.invalid/';
        if (!options.httpAgent || !options.httpsAgent) {
            throw new Error('Provider transport requires pinned agents');
        }
        const agent = options.httpsAgent as HttpsAgent & {
            options: AgentOptions;
        };
        agent.options.servername = isIP(hostname) ? '' : hostname;
        agent.options.checkServerIdentity = (_name, certificate) =>
            checkServerIdentity(hostname, certificate);
        const response = await axios.get<T>(root, {
            ...options,
            params: undefined,
            transport: {
                request: (
                    requestOptions: RequestOptions,
                    callback: (response: IncomingMessage) => void
                ) => {
                    // Path is HTTP metadata, never parsed as an authority.
                    // Even //host/path remains a path on the pinned connection.
                    const request = (secure ? httpsRequest : httpRequest)(
                        {
                            ...requestOptions,
                            hostname: 'provider.invalid',
                            port,
                            path: target.pathname + target.search,
                        },
                        callback
                    );
                    retainHeaderTimeout(request, options.timeout);
                    return request;
                },
            },
            headers: { ...options.headers, Host: target.host },
        });
        return {
            ...response,
            headers: {
                location:
                    typeof response.headers['location'] === 'string'
                        ? response.headers['location']
                        : undefined,
            },
        };
    }
}

/** Axios identifies native transports by identity; a custom one needs this timer. */
function retainHeaderTimeout(request: ClientRequest, timeout?: number): void {
    if (!timeout) return;
    const timer = setTimeout(
        () =>
            request.destroy(
                Object.assign(
                    new Error('Provider response headers timed out'),
                    { code: 'ECONNABORTED' }
                )
            ),
        timeout
    );
    timer.unref();
    const clear = () => {
        clearTimeout(timer);
        request.removeListener('response', clear);
        request.removeListener('error', clear);
        request.removeListener('close', clear);
    };
    request.once('response', clear);
    request.once('error', clear);
    request.once('close', clear);
}
