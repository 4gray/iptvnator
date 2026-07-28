import { type AddressInfo } from 'node:net';
import {
    createServer,
    get as httpGet,
    type Server,
    type ServerResponse,
} from 'node:http';
import type express from 'express';

export interface RunningTestServer {
    readonly origin: string;
    close(): Promise<void>;
}

export interface AbortableRequest {
    readonly completed: Promise<void>;
    abort(): void;
}

export async function startLoopbackServer(
    app: express.Express
): Promise<RunningTestServer> {
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address() as AddressInfo;

    return {
        origin: `http://127.0.0.1:${address.port}`,
        close: () => closeServer(server),
    };
}

export async function requestJson(
    origin: string,
    path: string,
    init: RequestInit = {}
): Promise<{ body: unknown; response: Response }> {
    const response = await fetch(`${origin}${path}`, init);
    const body = await response.json();
    return { body, response };
}

export async function postJson(
    origin: string,
    path: string,
    token: string,
    body?: unknown
): Promise<{ body: unknown; response: Response }> {
    return requestJson(origin, path, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-iptvnator-performance-token': token,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

export function openAbortableGet(
    origin: string,
    path: string,
    headers: Record<string, string> = {}
): AbortableRequest {
    let settled = false;
    let settle!: () => void;
    const completed = new Promise<void>((resolve) => {
        settle = resolve;
    });
    const request = httpGet(`${origin}${path}`, { headers }, (response) => {
        drain(response, () => {
            settled = true;
            settle();
        });
    });
    request.once('error', () => {
        settled = true;
        settle();
    });

    return {
        completed,
        abort() {
            if (!settled) request.destroy();
        },
    };
}

export async function waitFor(
    assertion: () => Promise<void>,
    timeoutMs = 2_000
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            await assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }
    throw lastError;
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
    });
}

function drain(
    response: ServerResponse | NodeJS.ReadableStream,
    done: () => void
) {
    response.on('data', () => undefined);
    response.once('end', done);
    response.once('error', done);
}
