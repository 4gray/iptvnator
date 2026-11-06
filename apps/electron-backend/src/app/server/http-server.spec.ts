import { once } from 'node:events';
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import { hostname, tmpdir } from 'node:os';
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

function request(
    port: number,
    path: string,
    options: Pick<http.RequestOptions, 'method' | 'headers'> = {}
): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
        const clientRequest = http.request(
            {
                host: '127.0.0.1',
                method: 'GET',
                path,
                port,
                ...options,
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
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

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
                void captured.listening.catch(() => undefined);
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
        await server.start(0);
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

    it.each([
        { Origin: 'http://unrelated.example.test' },
        { Origin: 'null' },
        { 'Content-Type': 'text/plain' },
        { 'Content-Type': '' },
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        {
            Host: 'unrelated.example.test',
            Origin: 'http://unrelated.example.test',
        },
        { 'Sec-Fetch-Site': 'cross-site' },
    ])('rejects unsafe command headers %j before dispatch', async (headers) => {
        const handler = jest.fn(
            (_request: http.IncomingMessage, response: http.ServerResponse) =>
                response.end()
        );
        server.registerRemoteControlHandler(
            '/api/remote-control/channel/up',
            handler
        );
        const captured = await startServer();
        const response = await request(
            getAddress(captured.server).port,
            '/api/remote-control/channel/up',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
            }
        );
        expect(response.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it.each([undefined, '127.0.0.1', 'localhost', hostname().toLowerCase()])(
        'accepts local JSON commands with host %s',
        async (host) => {
            const handler = jest.fn(
                (
                    _request: http.IncomingMessage,
                    response: http.ServerResponse
                ) => response.end()
            );
            server.registerRemoteControlHandler(
                '/api/remote-control/channel/up',
                handler
            );
            const captured = await startServer();
            const port = getAddress(captured.server).port;
            const response = await request(
                port,
                '/api/remote-control/channel/up',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        ...(host
                            ? {
                                  Host: `${host}:${port}`,
                                  Origin: `http://${host}:${port}`,
                              }
                            : {}),
                    },
                }
            );
            expect(response.statusCode).toBe(200);
            expect(handler).toHaveBeenCalledTimes(1);
        }
    );

    it('rejects a rebinding Host even when its port and Origin match', async () => {
        const handler = jest.fn(
            (_request: http.IncomingMessage, response: http.ServerResponse) =>
                response.end()
        );
        server.registerRemoteControlHandler(
            '/api/remote-control/channel/up',
            handler
        );
        const captured = await startServer();
        const port = getAddress(captured.server).port;
        const response = await request(port, '/api/remote-control/channel/up', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Host: `unrelated.example.test:${port}`,
                Origin: `http://unrelated.example.test:${port}`,
            },
        });
        expect(response.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects a foreign-origin status read before dispatch', async () => {
        const handler = jest.fn(
            (_request: http.IncomingMessage, response: http.ServerResponse) =>
                response.end()
        );
        server.registerRemoteControlHandler(
            '/api/remote-control/status',
            handler
        );
        const captured = await startServer();
        const response = await request(
            getAddress(captured.server).port,
            '/api/remote-control/status',
            {
                headers: { Origin: 'http://unrelated.example.test' },
            }
        );
        expect(response.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
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
        await Promise.all([server.start(0), server.start(0)]);

        expect(capturedServers).toHaveLength(1);
        await capturedServers[0].listening;
        expect(capturedServers[0].listeningEvents).toBe(1);
    });

    it('rejects an occupied port and can retry after it becomes available', async () => {
        const blocker = http.createServer();
        await new Promise<void>((resolve) => blocker.listen(0, resolve));
        const port = getAddress(blocker).port;

        try {
            await expect(
                Promise.resolve(server.updateSettings(true, port))
            ).rejects.toMatchObject({ code: 'EADDRINUSE' });
        } finally {
            await closeServer(blocker);
        }

        await server.updateSettings(true, port);
        const replacement = capturedServers.at(-1);
        if (!replacement) {
            throw new Error('Expected the retry to create a server');
        }
        await replacement.listening;
        await expect(request(port, '/')).resolves.toMatchObject({
            statusCode: 200,
        });
    });

    it('can retry after listen rejects an invalid port synchronously', async () => {
        await expect(server.start(-1)).rejects.toMatchObject({
            code: 'ERR_SOCKET_BAD_PORT',
        });

        const captured = await startServer();
        expect(captured.server.listening).toBe(true);
    });

    it('finishes disabled when disabled while startup is pending', async () => {
        await Promise.all([
            server.updateSettings(true, 0),
            server.updateSettings(false, 0),
        ]);

        expect(capturedServers).toHaveLength(1);
        expect(capturedServers[0].server.listening).toBe(false);
    });

    it('serializes rapid toggles and port changes, including returning to the first port', async () => {
        const firstPort = await getAvailablePort();
        const secondPort = await getAvailablePort();

        await Promise.all([
            server.updateSettings(true, firstPort),
            server.updateSettings(false, firstPort),
            server.updateSettings(true, secondPort),
            server.updateSettings(true, firstPort),
        ]);

        expect(capturedServers).toHaveLength(3);
        expect(capturedServers.map(({ server }) => server.listening)).toEqual([
            false,
            false,
            true,
        ]);
        expect(getAddress(capturedServers[2].server).port).toBe(firstPort);
        await expect(request(firstPort, '/')).resolves.toMatchObject({
            statusCode: 200,
        });
    });

    it('handles a listener error after startup and permits a later retry', async () => {
        const captured = await startServer();
        const closed = new Promise<void>((resolve) => {
            captured.server.once('close', resolve);
        });

        captured.server.emit('error', new Error('Listener failure'));
        await closed;
        await server.updateSettings(true, 0);

        expect(capturedServers).toHaveLength(2);
        expect(capturedServers[1].server.listening).toBe(true);
    });

    it('stops the running server when disabled', async () => {
        const captured = await startServer();
        const closed = once(captured.server, 'close');

        await server.updateSettings(false, 0);
        await closed;

        expect(captured.server.listening).toBe(false);
        expect(capturedServers).toHaveLength(1);
    });

    it.each(['disable', 'change port'])(
        'finishes %s with an unfinished HTTP request body',
        async (action) => {
            const requestStarted = new Promise<void>((resolve) => {
                server.registerRemoteControlHandler(
                    '/api/remote-control/pending',
                    (incomingRequest, response) => {
                        incomingRequest.on('data', () => undefined);
                        incomingRequest.on('end', () => response.end());
                        resolve();
                    }
                );
            });
            const captured = await startServer();
            const nextPort = await getAvailablePort();
            const client = createConnection({
                host: '127.0.0.1',
                port: getAddress(captured.server).port,
            });
            client.on('error', () => undefined);
            await once(client, 'connect');
            client.write(
                'POST /api/remote-control/pending HTTP/1.1\r\n' +
                    `Host: 127.0.0.1:${getAddress(captured.server).port}\r\n` +
                    'Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{'
            );
            await requestStarted;

            const update = server.updateSettings(
                action === 'change port',
                nextPort
            );
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([
                    update,
                    new Promise<never>((_resolve, reject) => {
                        timeout = setTimeout(() => {
                            reject(
                                new Error(
                                    'Server update waited for unfinished request body'
                                )
                            );
                        }, 1000);
                    }),
                ]);
                expect(captured.server.listening).toBe(false);
                if (action === 'change port') {
                    await expect(request(nextPort, '/')).resolves.toMatchObject(
                        {
                            statusCode: 200,
                        }
                    );
                }
            } finally {
                clearTimeout(timeout);
                client.destroy();
                await update;
            }
        }
    );

    it('stops once and starts once on the new port when the port changes', async () => {
        const first = await startServer();
        const newPort = await getAvailablePort();
        let closeEvents = 0;
        first.server.on('close', () => {
            closeEvents += 1;
        });
        const firstClosed = once(first.server, 'close');

        await server.updateSettings(true, newPort);
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
