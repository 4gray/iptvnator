import type { ServerStorageErrorBody } from '@iptvnator/shared/interfaces';
import {
    clearServerAccessToken,
    serverAuthorizationHeaders,
} from '../server-access-token';
import type { ServerStorageStatusService } from '../server-storage-status.service';

const REQUEST_TIMEOUT_MS = 20_000;

export class ServerApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | undefined,
        message: string
    ) {
        super(message);
        this.name = 'ServerApiError';
    }
}

export interface ServerApiClientOptions {
    readonly baseUrl: string;
    readonly status: Pick<
        ServerStorageStatusService,
        'reportSuccess' | 'reportOffline' | 'reportUnauthorized'
    >;
    /** Failed writes the user should hear about: network, 413, 5xx. */
    readonly onWriteFailure?: (error: ServerApiError) => void;
    readonly fetchFn?: typeof fetch;
    readonly timeoutMs?: number;
}

/** `fetch` for `/v1`: token, timeout, error mapping, connection state. */
export class ServerApiClient {
    private readonly root: string;

    constructor(private readonly options: ServerApiClientOptions) {
        this.root = `${options.baseUrl.replace(/\/+$/, '')}/v1`;
    }

    url(path: string): string {
        return `${this.root}${path}`;
    }

    async request(path: string, init: RequestInit = {}): Promise<Response> {
        const isWrite = (init.method ?? 'GET') !== 'GET';
        let response: Response;
        try {
            response = await this.fetchFn()(this.url(path), {
                ...init,
                cache: 'no-store',
                headers: {
                    ...serverAuthorizationHeaders(),
                    ...(init.headers as Record<string, string> | undefined),
                },
                signal: init.signal ?? this.timeoutSignal(),
            });
        } catch {
            this.options.status.reportOffline();
            const error = new ServerApiError(
                0,
                'network',
                'The server is not reachable.'
            );
            if (isWrite) {
                this.options.onWriteFailure?.(error);
            }
            throw error;
        }

        if (response.status === 401) {
            clearServerAccessToken();
            this.options.status.reportUnauthorized();
            throw new ServerApiError(
                401,
                'unauthorized',
                'The server needs an access token.'
            );
        }

        if (!response.ok && response.status !== 304) {
            const body = await readErrorBody(response);
            const error = new ServerApiError(
                response.status,
                body.code,
                body.message
            );
            if (
                isWrite &&
                (response.status === 413 || response.status >= 500)
            ) {
                this.options.onWriteFailure?.(error);
            }
            throw error;
        }

        this.options.status.reportSuccess();
        return response;
    }

    async getJson<T>(path: string): Promise<T> {
        return (await this.request(path)).json() as Promise<T>;
    }

    sendJson(
        method: 'PUT' | 'POST',
        path: string,
        body: unknown
    ): Promise<Response> {
        return this.request(path, {
            method,
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    /** Best effort while the page is hidden or closed; errors are ignored. */
    sendKeepalive(
        method: 'PUT' | 'DELETE',
        path: string,
        body?: unknown
    ): void {
        void this.fetchFn()(this.url(path), {
            method,
            keepalive: true,
            headers: {
                ...serverAuthorizationHeaders(),
                ...(body === undefined
                    ? {}
                    : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }).catch(() => undefined);
    }

    private fetchFn(): typeof fetch {
        return this.options.fetchFn ?? globalThis.fetch.bind(globalThis);
    }

    private timeoutSignal(): AbortSignal | undefined {
        return typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(this.options.timeoutMs ?? REQUEST_TIMEOUT_MS)
            : undefined;
    }
}

async function readErrorBody(
    response: Response
): Promise<{ message: string; code?: string }> {
    try {
        const body = (await response.json()) as Partial<ServerStorageErrorBody>;
        return {
            message: body.message ?? response.statusText,
            code: body.code,
        };
    } catch {
        return { message: response.statusText };
    }
}
