import { once } from 'node:events';
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpServer } from './http-server';

interface CapturedServer {
    listening: Promise<void>;
    listeningEvents: number;
    server: http.Server;
}

interface TestResponse {
    body: Buffer;
    contentType: string | undefined;
    statusCode: number | undefined;
}

const INDEX_BODY = Buffer.from('<main>IPTVnator remote control</main>');
const ASSETS = {
    '/app.js': {
        body: Buffer.from('globalThis.remoteControlLoaded = true;'),
        contentType: 'application/javascript',
    },
    '/styles.css': {
        body: Buffer.from('main { color: rebeccapurple; }'),
        contentType: 'text/css',
    },
    '/data.json': {
        body: Buffer.from('{"ready":true}'),
        contentType: 'application/json',
    },
    '/asset.unknown': {
        body: Buffer.from([0x00, 0xff, 0x49, 0x50, 0x54, 0x56]),
        contentType: 'application/octet-stream',
    },
} as const;

jest.setTimeout(15_000);

function request(port: number, path: string): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
        const clientRequest = http.request(
            {
                host: '127.0.0.1',
                method: 'GET',
                path,
                port,
            },
            (response) => {
                const chunks: Buffer[] = [];

                response.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    const contentType = response.headers['content-type'];
                    resolve({
                        body: Buffer.concat(chunks),
                        contentType:
                            typeof contentType === 'string'
                                ? contentType
                                : undefined,
                        statusCode: response.statusCode,
                    });
                });
                response.on('error', reject);
            }
        );

        clientRequest.on('error', reject);
        clientRequest.end();
    });
}

function getAddress(server: http.Server): AddressInfo {
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Expected the HTTP server to have an IP address');
    }
    return address;
}

async function closeServer(server: http.Server): Promise<void> {
    if (!server.listening) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

async function getAvailablePort(): Promise<number> {
    const probe = http.createServer();

    await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
    });

    const port = getAddress(probe).port;
    await closeServer(probe);
    return port;
}

describe('HttpServer', () => {
    let capturedServers: CapturedServer[];
    let distPath: string;
    let server: HttpServer;
    let tempRoot: string;

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);

        capturedServers = [];
        tempRoot = mkdtempSync(join(tmpdir(), 'iptvnator-http-server-'));
        distPath = join(tempRoot, 'static', 'app');
        mkdirSync(distPath, { recursive: true });
        writeFileSync(join(distPath, 'index.html'), INDEX_BODY);

        for (const [assetPath, asset] of Object.entries(ASSETS)) {
            writeFileSync(join(distPath, assetPath), asset.body);
        }

        writeFileSync(
            join(tempRoot, 'outside-secret.txt'),
            'must-not-leave-the-static-directory'
        );

        server = new HttpServer({
            createServer: (requestListener) => {
                const nodeServer = http.createServer(requestListener);
                const captured: CapturedServer = {
                    listening: once(nodeServer, 'listening').then(
                        () => undefined
                    ),
                    listeningEvents: 0,
                    server: nodeServer,
                };
                nodeServer.on('listening', () => {
                    captured.listeningEvents += 1;
                });
                capturedServers.push(captured);
                return nodeServer;
            },
            distPath,
        });
    });

    afterEach(async () => {
        let closeError: unknown;

        try {
            await Promise.all(
                capturedServers.map(({ server: nodeServer }) =>
                    closeServer(nodeServer)
                )
            );
        } catch (error) {
            closeError = error;
        } finally {
            rmSync(tempRoot, { force: true, recursive: true });
            jest.restoreAllMocks();
        }

        if (closeError) {
            throw closeError;
        }
    });

    async function startServer(): Promise<CapturedServer> {
        const serverIndex = capturedServers.length;
        server.start(0);
        const captured = capturedServers[serverIndex];
        if (!captured) {
            throw new Error('Expected HttpServer.start() to create a server');
        }

        await captured.listening;
        return captured;
    }

    it('serves the exact index document at the root', async () => {
        const captured = await startServer();

        const response = await request(getAddress(captured.server).port, '/');

        expect(response).toEqual({
            body: INDEX_BODY,
            contentType: 'text/html',
            statusCode: 200,
        });
    });

    it('asks the operating system for an ephemeral port when started with zero', async () => {
        const captured = await startServer();

        expect(getAddress(captured.server).port).not.toBe(8765);
    });

    it.each(Object.entries(ASSETS))(
        'serves %s with its expected MIME type',
        async (assetPath, asset) => {
            const captured = await startServer();

            const response = await request(
                getAddress(captured.server).port,
                assetPath
            );

            expect(response).toEqual({
                body: asset.body,
                contentType: asset.contentType,
                statusCode: 200,
            });
        }
    );

    it('falls back to the exact index document for a client route', async () => {
        const captured = await startServer();

        const response = await request(
            getAddress(captured.server).port,
            '/channels/favorites'
        );

        expect(response).toEqual({
            body: INDEX_BODY,
            contentType: 'text/html',
            statusCode: 200,
        });
    });

    it('returns a plain-text 404 when the index document is missing', async () => {
        unlinkSync(join(distPath, 'index.html'));
        const captured = await startServer();

        const response = await request(getAddress(captured.server).port, '/');

        expect(response).toEqual({
            body: Buffer.from('404 Not Found'),
            contentType: 'text/plain',
            statusCode: 404,
        });
    });

    it('dispatches a registered API request without serving a static file', async () => {
        let receivedRequest: http.IncomingMessage | undefined;
        server.registerRemoteControlHandler(
            '/api/remote-control/status',
            (incomingRequest, response) => {
                receivedRequest = incomingRequest;
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end('{"source":"api-handler"}');
            }
        );
        const captured = await startServer();

        const response = await request(
            getAddress(captured.server).port,
            '/api/remote-control/status'
        );

        expect(receivedRequest?.url).toBe('/api/remote-control/status');
        expect(response).toEqual({
            body: Buffer.from('{"source":"api-handler"}'),
            contentType: 'application/json',
            statusCode: 200,
        });
        expect(response.body).not.toEqual(INDEX_BODY);
    });

    it('returns a JSON 404 for an unknown remote-control API endpoint', async () => {
        const captured = await startServer();

        const response = await request(
            getAddress(captured.server).port,
            '/api/remote-control/missing'
        );

        expect(response).toEqual({
            body: Buffer.from('{"error":"Endpoint not found"}'),
            contentType: 'application/json',
            statusCode: 404,
        });
    });

    it.each([
        '/../../outside-secret.txt',
        '//../../outside-secret.txt',
        '/%2e%2e/%2e%2e/outside-secret.txt',
        '/%E0%A4%A',
    ])(
        'rejects the invalid static request target %s without serving an outside file',
        async (requestTarget) => {
            const captured = await startServer();

            const response = await request(
                getAddress(captured.server).port,
                requestTarget
            );

            expect(response).toEqual({
                body: Buffer.from('404 Not Found'),
                contentType: 'text/plain',
                statusCode: 404,
            });
            expect(response.body.toString()).not.toContain(
                'must-not-leave-the-static-directory'
            );
        }
    );

    it('creates and listens on only one server when started twice', async () => {
        server.start(0);
        server.start(0);

        expect(capturedServers).toHaveLength(1);
        await capturedServers[0].listening;
        expect(capturedServers[0].listeningEvents).toBe(1);
    });

    it('stops the running server when disabled', async () => {
        const captured = await startServer();
        const closed = once(captured.server, 'close');

        server.updateSettings(false, 0);
        await closed;

        expect(captured.server.listening).toBe(false);
        expect(capturedServers).toHaveLength(1);
    });

    it('stops once and starts once on the new port when the port changes', async () => {
        const first = await startServer();
        const newPort = await getAvailablePort();
        let closeEvents = 0;
        first.server.on('close', () => {
            closeEvents += 1;
        });
        const firstClosed = once(first.server, 'close');

        server.updateSettings(true, newPort);
        const second = capturedServers[1];
        if (!second) {
            throw new Error('Expected a replacement HTTP server');
        }
        await Promise.all([firstClosed, second.listening]);

        expect(capturedServers).toHaveLength(2);
        expect(closeEvents).toBe(1);
        expect(first.server.listening).toBe(false);
        expect(second.listeningEvents).toBe(1);
        expect(getAddress(second.server).port).toBe(newPort);
        await expect(request(newPort, '/')).resolves.toEqual({
            body: INDEX_BODY,
            contentType: 'text/html',
            statusCode: 200,
        });
    });
});
