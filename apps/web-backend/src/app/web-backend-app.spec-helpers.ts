/**
 * Shared fixtures for the web backend specs.
 *
 * Extracted so the host-guard spec can drive the same stub transport and
 * throwaway server as the main spec without a second copy of either — and so
 * neither file has to grow past the 1200-line test limit to hold them.
 */

import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { STALKER_MAG_USER_AGENT } from '@iptvnator/shared/interfaces';
import {
    createWebBackendApp,
    WebBackendHttpClient,
    WebBackendHttpGetOptions,
} from './web-backend-app';

/** The transport-identity headers every portal-facing Stalker request carries. */
export const STALKER_IDENTITY_HEADERS = {
    'User-Agent': STALKER_MAG_USER_AGENT,
    'X-User-Agent': STALKER_MAG_USER_AGENT,
    Accept: '*/*',
    Connection: 'keep-alive',
    'Accept-Language': 'en-US,en;q=0.9',
};

export interface HttpRequest {
    readonly headers?: Record<string, string>;
    readonly params?: Record<string, string>;
    readonly responseData: unknown;
    readonly responseStatus?: number;
    readonly timeout?: number;
    readonly url: string;
}

export class StubHttpClient implements WebBackendHttpClient {
    readonly requests: Omit<HttpRequest, 'responseData' | 'responseStatus'>[] =
        [];
    private readonly queuedResponses: Array<{
        readonly data: unknown;
        readonly error?: Error;
        readonly status?: number;
        readonly statusText?: string;
    }> = [];

    queueResponse(data: unknown): void {
        this.queuedResponses.push({ data });
    }

    queueFailure(status: number, statusText = 'Provider failure'): void {
        this.queuedResponses.push({ data: null, status, statusText });
    }

    queueNetworkFailure(message = 'connect ECONNREFUSED'): void {
        this.queuedResponses.push({ data: null, error: new Error(message) });
    }

    queueNetworkError(error: Error): void {
        this.queuedResponses.push({ data: null, error });
    }

    async get<T>(
        url: string,
        options: WebBackendHttpGetOptions = {}
    ): Promise<{ data: T }> {
        this.requests.push({
            headers: options.headers,
            params: options.params,
            timeout: options.timeout,
            url,
        });

        const response = this.queuedResponses.shift();
        if (!response) {
            throw new Error(`No queued response for ${url}`);
        }

        if (response.error) {
            throw response.error;
        }

        if (response.status) {
            const error = new Error(response.statusText) as Error & {
                response: { status: number; statusText: string };
            };
            error.response = {
                status: response.status,
                statusText: response.statusText ?? 'Provider failure',
            };
            throw error;
        }

        return { data: response.data as T };
    }
}

export const resolvePublicHost = async () => ['93.184.216.34'];

export async function registerProviderTarget(
    baseUrl: string,
    url: string
): Promise<string> {
    const response = await fetch(`${baseUrl}/provider-targets`, {
        body: JSON.stringify({ url }),
        headers: {
            'content-type': 'application/json',
        },
        method: 'POST',
    });
    const body = (await response.json()) as { targetId: string };
    return body.targetId;
}

export async function withServer<T>(
    app: ReturnType<typeof createWebBackendApp>,
    callback: (baseUrl: string) => Promise<T>
): Promise<T> {
    const server = await new Promise<Server>((resolve) => {
        const started = app.listen(0, '127.0.0.1', () => resolve(started));
    });

    try {
        const address = server.address() as AddressInfo;
        return await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}
