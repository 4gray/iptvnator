import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import type { SyntheticM3uFixture } from './synthetic-m3u';

export const SYNTHETIC_M3U_RESOURCE_PATH = '/synthetic-performance.m3u';

export interface SyntheticM3uServer {
    readonly origin: string;
    readonly resourceUrl: string;
    close(): Promise<void>;
    prime(): Promise<void>;
    requestCount(): number;
}

export async function startSyntheticM3uServer(
    fixture: SyntheticM3uFixture
): Promise<SyntheticM3uServer> {
    let successfulRequestCount = 0;
    const server = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (
            request.method !== 'GET' ||
            requestUrl.pathname !== SYNTHETIC_M3U_RESOURCE_PATH ||
            requestUrl.search.length > 0
        ) {
            response.writeHead(404, {
                'Content-Length': '0',
                'Content-Type': 'text/plain; charset=utf-8',
            });
            response.end();
            return;
        }

        successfulRequestCount += 1;
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Length': String(fixture.bytes),
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        });
        response.end(fixture.body);
    });
    server.listen({
        exclusive: true,
        host: '127.0.0.1',
        port: 0,
    });
    try {
        await once(server, 'listening');
    } catch (error: unknown) {
        await closeServer(server).catch(() => undefined);
        throw error;
    }

    const address = server.address();
    if (
        address === null ||
        typeof address === 'string' ||
        address.address !== '127.0.0.1' ||
        !Number.isSafeInteger(address.port) ||
        address.port <= 0
    ) {
        await closeServer(server);
        throw new Error(
            'Synthetic M3U server did not bind exact IPv4 loopback'
        );
    }

    const origin = `http://127.0.0.1:${address.port}`;
    const resourceUrl = `${origin}${SYNTHETIC_M3U_RESOURCE_PATH}`;
    let closePromise: Promise<void> | null = null;

    return Object.freeze({
        origin,
        resourceUrl,
        close: () => {
            closePromise ??= closeServer(server);
            return closePromise;
        },
        prime: async () => {
            if (closePromise !== null) {
                throw new Error('Synthetic M3U server is closed');
            }
            const response = await fetch(resourceUrl);
            const body = await response.arrayBuffer();
            if (
                response.status !== 200 ||
                Number(response.headers.get('content-length')) !==
                    fixture.bytes ||
                body.byteLength !== fixture.bytes
            ) {
                throw new Error(
                    'Synthetic M3U server priming response was invalid'
                );
            }
        },
        requestCount: () => successfulRequestCount,
    });
}

async function closeServer(server: Server): Promise<void> {
    if (!server.listening) {
        return;
    }
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
            if (error) {
                rejectPromise(error);
                return;
            }
            resolvePromise();
        });
    });
}
