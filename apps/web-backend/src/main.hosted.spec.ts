import type { Server } from 'node:http';
import {
    fetchTestServer,
    requestTestServer,
    serverOrigin,
} from './app/http-server.spec-helpers';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostedServerWorkerMessage } from '@iptvnator/shared/interfaces';
import type { ServerDatabase } from './app/storage/server-database';

// Node fetch rewrites Host; exercise a proxy-preserved Host with raw HTTP.
function proxyGet(
    server: Server,
    url: string,
    options: { headers: Record<string, string> }
) {
    return new Promise<{
        status: number;
        cacheControl?: string;
        json: () => Promise<Record<string, unknown>>;
    }>((resolve, reject) => {
        requestTestServer(
            server,
            url,
            options,
            (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    body += chunk;
                });
                response.on('end', () =>
                    resolve({
                        status: response.statusCode!,
                        cacheControl: response.headers['cache-control'],
                        json: async () => JSON.parse(body),
                    })
                );
                response.on('error', reject);
            }
        )
            .on('error', reject)
            .end();
    });
}

jest.mock('./app/hosted-listener', () => {
    const actual = jest.requireActual<typeof import('./app/hosted-listener')>(
        './app/hosted-listener'
    );
    return { listenHosted: jest.fn(actual.listenHosted) };
});
jest.mock('./app/storage/server-storage', () => ({
    ...jest.requireActual('./app/storage/server-storage'),
    openServerStorage: jest.fn(),
}));

describe('hosted web backend worker', () => {
    const processWithParent = process as NodeJS.Process & {
        parentPort?: EventEmitter;
    };
    const originalParent = processWithParent.parentPort;
    let directory: string;
    let database: ServerDatabase | undefined;
    let parent: EventEmitter & {
        postMessage: (message: HostedServerWorkerMessage) => void;
    };
    let exited: Promise<number | undefined>;
    const servers: Server[] = [];

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'iptvnator-web-worker-'));
        const assets = join(directory, 'pwa');
        await mkdir(assets);
        database = undefined;
        await writeFile(
            join(assets, 'index.html'),
            '<title>Synthetic hosted app</title>'
        );
        jest.replaceProperty(process, 'env', {
            ...process.env,
            IPTVNATOR_STORAGE: 'server',
            IPTVNATOR_DATA_DIR: join(directory, 'data'),
            IPTVNATOR_ACCESS_TOKEN: 'synthetic-access-code',
            IPTVNATOR_HOSTED_ASSETS: assets,
            IPTVNATOR_HOSTED_LAN: '127.0.0.1',
            PORT: '0',
        });
        parent = Object.assign(new EventEmitter(), {
            postMessage: (message: HostedServerWorkerMessage) => {
                parent.emit('reply', message);
            },
        });
        processWithParent.parentPort = parent;
        exited = new Promise((resolve) => {
            jest.spyOn(process, 'exit').mockImplementation((code) => {
                resolve(typeof code === 'number' ? code : undefined);
                return undefined as never;
            });
        });
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await Promise.all(
            servers.splice(0).map(
                (server) =>
                    new Promise<void>((resolve) => {
                        if (server.listening) server.close(() => resolve());
                        else resolve();
                    })
            )
        );
        if (originalParent) processWithParent.parentPort = originalParent;
        else delete processWithParent.parentPort;
        jest.restoreAllMocks();
        if (database?.sqlite.open) database.close();
        await rm(directory, { recursive: true, force: true });
    });

    async function startWorker(failSecond?: 'port' | 'startup') {
        const response = once(parent, 'reply');
        await jest.isolateModulesAsync(async () => {
            const { listenHosted } = await import('./app/hosted-listener');
            const { openServerStorage } =
                await import('./app/storage/server-storage');
            const actual = jest.requireActual<
                typeof import('./app/hosted-listener')
            >('./app/hosted-listener');
            jest.mocked(listenHosted).mockImplementation(async (...args) => {
                if (failSecond && servers.length === 1) {
                    throw Object.assign(new Error('synthetic listen failure'), {
                        code:
                            failSecond === 'port'
                                ? 'EADDRINUSE'
                                : 'EADDRNOTAVAIL',
                    });
                }
                // Keep this test independent of a running desktop instance.
                args[2] = 0;
                const server = await actual.listenHosted(...args);
                servers.push(server);
                return server;
            });
            const realStorage = jest.requireActual<
                typeof import('./app/storage/server-storage')
            >('./app/storage/server-storage');
            jest.mocked(openServerStorage).mockImplementation(async () => {
                const storage = await realStorage.openServerStorage();
                database = storage.database;
                return storage;
            });
            await import('./main');
        });
        return (await response)[0] as HostedServerWorkerMessage;
    }

    it('announces readiness after both listeners serve the app and closes them before exiting', async () => {
        const reply = await startWorker();
        expect(reply).toEqual({ ready: true, instanceId: expect.any(String) });
        expect(servers).toHaveLength(2);
        for (const server of servers) {
            const origin = serverOrigin(server);
            const fetch = fetchTestServer(server);
            const page = await fetch(origin + '/workspace/dashboard');
            expect(page.headers.get('cache-control')).toBe('no-cache');
            expect(await page.text()).toContain('Synthetic hosted app');
            const api = await fetch(origin + '/api/v1/instance');
            expect(api.status).toBe(200);
            expect(await api.json()).toMatchObject({
                instanceId: database?.instanceId,
            });
        }
        const remoteOrigin = 'https://library.example.test';
        const configure = async (httpsOrigin: string, requestId: string) => {
            const response = once(parent, 'reply');
            parent.emit('message', { data: { httpsOrigin, requestId } });
            return (await response)[0];
        };
        expect(await configure(remoteOrigin, 'enable')).toEqual({
            https: true,
            requestId: 'enable',
            origin: remoteOrigin,
        });
        const remote = servers[2];
        const remoteUrl = serverOrigin(remote);
        const headers = { host: 'library.example.test', origin: remoteOrigin };
        expect(
            await proxyGet(remote, remoteUrl + '/workspace/dashboard', {
                headers,
            })
        ).toMatchObject({ status: 200, cacheControl: 'no-store' });
        expect(
            (
                await proxyGet(remote, remoteUrl + '/api/v1/instance', {
                    headers,
                }).then((response) => response.json())
            ).instanceId
        ).toBe(database?.instanceId);
        expect(
            (await proxyGet(remote, remoteUrl + '/api/v1/sources', { headers }))
                .status
        ).toBe(401);
        expect(
            await proxyGet(remote, remoteUrl + '/api/v1/sources', {
                headers: {
                    ...headers,
                    authorization: 'Bearer synthetic-access-code',
                },
            })
        ).toMatchObject({ status: 200, cacheControl: 'no-store' });
        expect(
            (
                await proxyGet(remote, remoteUrl + '/', {
                    headers: { ...headers, origin: 'https://attacker.test' },
                })
            ).status
        ).toBe(403);
        expect(await configure('', 'disable')).toEqual({
            https: true,
            requestId: 'disable',
            origin: '',
        });
        await expect(
            proxyGet(remote, remoteUrl + '/', { headers })
        ).rejects.toThrow();
        expect(database?.sqlite.open).toBe(true);
        expect(servers.slice(0, 2).every((server) => server.listening)).toBe(
            true
        );
        await configure(remoteOrigin, 'enable-again');
        parent.emit('message', { data: 'stop' });
        expect(await exited).toBe(0);
        expect(servers.every((server) => !server.listening)).toBe(true);
        expect(database?.sqlite.open).toBe(false);
    }, 15000); // Includes the worker's five-second graceful shutdown deadline.

    it.each(['port', 'startup'] as const)(
        'closes the first listener and storage when the second reports a %s failure',
        async (failure) => {
            expect(await startWorker(failure)).toEqual({ error: failure });
            expect(await exited).toBe(1);
            expect(servers).toHaveLength(1);
            expect(servers[0].listening).toBe(false);
            expect(database?.sqlite.open).toBe(false);
        }
    );
});
