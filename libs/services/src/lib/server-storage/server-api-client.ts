import type {
    ServerStorageErrorBody,
    ServerUserStateCurrent,
    ServerUserStateWriteResponse,
} from '@iptvnator/shared/interfaces';
import type { ServerStorageStatusService } from '../server-storage-status.service';

const REQUEST_TIMEOUT_MS = 20_000;

/** A user-state write for a playlist the server no longer has. */
export const PLAYLIST_MISSING = 'playlist_missing';

/** nginx answers these while the backend behind it is down. */
const GATEWAY_UNAVAILABLE = new Set([502, 503, 504]);

export class ServerApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | undefined,
        message: string,
        /** A `412` conflict's user-state entry as the server has it. */
        readonly current?: ServerUserStateCurrent
    ) {
        super(message);
        this.name = 'ServerApiError';
    }
}

/** How a page-hide write ended, as far as the page could see. */
export type KeepaliveOutcome =
    | { readonly status: 'saved'; readonly tag?: string | null }
    | { readonly status: 'conflict'; readonly current: ServerUserStateCurrent }
    | { readonly status: 'gone' }
    | { readonly status: 'failed' };

export interface ServerApiClientOptions {
    readonly baseUrl: string;
    readonly status: Pick<
        ServerStorageStatusService,
        'reportSuccess' | 'reportOffline' | 'reportAccessDenied'
    >;
    /** Failed writes the user should hear about: network, 413, 5xx. */
    readonly onWriteFailure?: (error: ServerApiError) => void;
    readonly fetchFn?: typeof fetch;
    readonly timeoutMs?: number;
    /**
     * Refuse writes as if offline while true: an instance not checked yet
     * (a start from memory, or one that went offline), whose address may
     * lead to another database by the time it answers.
     */
    readonly holdWrites?: () => boolean;
    /** The token to send (`ServerStorageStatusService.accessToken`). */
    readonly accessToken: () => string | null;
}

/** `fetch` for `/v1`: token, timeout, error mapping, connection state. */
export class ServerApiClient {
    private readonly root: string;

    constructor(private readonly options: ServerApiClientOptions) {
        this.root = `${options.baseUrl.replace(/\/+$/, '')}/v1`;
    }

    private token(): string | null {
        return this.options.accessToken();
    }

    url(path: string): string {
        return `${this.root}${path}`;
    }

    async request(path: string, init: RequestInit = {}): Promise<Response> {
        const isWrite = (init.method ?? 'GET') !== 'GET';
        const token = this.token();
        let response: Response;
        try {
            if (isWrite && this.options.holdWrites?.()) {
                throw new Error('Writes wait for the instance to answer.');
            }
            response = await this.fetchFn()(this.url(path), {
                ...init,
                cache: 'no-store',
                headers: {
                    ...bearer(token),
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
            this.options.status.reportAccessDenied(token);
            throw new ServerApiError(
                401,
                'unauthorized',
                'The server needs an access token.'
            );
        }

        if (GATEWAY_UNAVAILABLE.has(response.status)) {
            // A proxy in front of a backend that is down or restarting.
            this.options.status.reportOffline();
        }

        if (!response.ok && response.status !== 304) {
            const body = await readErrorBody(response);
            const error = new ServerApiError(
                response.status,
                body.code,
                body.message,
                body.current
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
        return this.readJson<T>(await this.request(path));
    }

    /**
     * A body cut off after the headers arrived is an outage too; malformed
     * JSON is not.
     */
    async readJson<T>(response: Response): Promise<T> {
        try {
            return (await response.json()) as T;
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw error;
            }
            this.options.status.reportOffline();
            throw new ServerApiError(
                0,
                'network',
                'The server is not reachable.'
            );
        }
    }

    sendJson(
        method: 'PUT' | 'POST',
        path: string,
        body: unknown,
        headers: Record<string, string> = {}
    ): Promise<Response> {
        return this.request(path, {
            method,
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json', ...headers },
        });
    }

    /**
     * A write that survives the page. Browsers reject keepalive bodies
     * above 64 KiB, which ends as `failed`.
     */
    async sendKeepalive(
        method: 'PUT' | 'DELETE',
        path: string,
        body?: unknown,
        headers: Record<string, string> = {}
    ): Promise<KeepaliveOutcome> {
        if (this.options.holdWrites?.()) {
            return { status: 'failed' };
        }
        const token = this.token();
        try {
            const response = await this.fetchFn()(this.url(path), {
                method,
                keepalive: true,
                headers: {
                    ...bearer(token),
                    ...headers,
                    ...(body === undefined
                        ? {}
                        : { 'Content-Type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                // A server that takes the request and never answers would
                // hold every later write behind it.
                signal: this.timeoutSignal(),
            });
            if (response.ok) {
                const body = (await response.json().catch(() => {
                    // Saved, on a version it cannot tell: cut off after its
                    // headers, which counts as offline, as for requests.
                    this.options.status.reportOffline();
                    return {};
                })) as Partial<ServerUserStateWriteResponse>;
                return { status: 'saved', tag: body?.tag };
            }
            if (GATEWAY_UNAVAILABLE.has(response.status)) {
                // As for requests: the backend may come back as another
                // instance, checked before the next write goes out.
                this.options.status.reportOffline();
            }
            if (response.status === 401) {
                // As for requests: a token replaced since is not refused.
                this.options.status.reportAccessDenied(token);
            }
            const { code, current } =
                response.status === 412 || response.status === 404
                    ? await readErrorBody(response)
                    : {};
            if (code === PLAYLIST_MISSING) {
                return { status: 'gone' };
            }
            return current
                ? { status: 'conflict', current }
                : { status: 'failed' };
        } catch {
            this.options.status.reportOffline();
            return { status: 'failed' };
        }
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
): Promise<Pick<ServerStorageErrorBody, 'message' | 'code' | 'current'>> {
    try {
        const body = (await response.json()) as Partial<ServerStorageErrorBody>;
        return {
            message: body.message ?? response.statusText,
            code: body.code,
            current: body.current,
        };
    } catch {
        return { message: response.statusText };
    }
}

function bearer(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}
