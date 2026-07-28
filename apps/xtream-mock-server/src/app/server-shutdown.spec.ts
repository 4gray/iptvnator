import { type AddressInfo } from 'node:net';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { PerformanceControlState } from './performance-control.js';
import {
    createXtreamMockApp,
    createXtreamMockServerShutdown,
} from './server.js';
import {
    openAbortableGet,
    postJson,
    requestJson,
    waitFor,
} from './testing/http-server.fixture.js';

jest.mock('@faker-js/faker', () => ({
    faker: { seed: jest.fn() },
}));

const TOKEN = 'shutdown-token';
const AUTH_HEADERS = {
    'x-iptvnator-performance-token': TOKEN,
};

describe('Xtream mock HTTP shutdown', () => {
    it.each([
        ['barrier', 'blocked'],
        ['delay', 'delayed'],
    ] as const)(
        'settles an active %s and releases its listener',
        async (kind, lifecycleStatus) => {
            const app = createXtreamMockApp({
                control: { enabled: true, token: TOKEN },
                host: '127.0.0.1',
                port: 0,
            });
            const server = createServer(app);
            await listen(server);
            const address = server.address() as AddressInfo;
            const origin = `http://127.0.0.1:${address.port}`;
            let heldClient: ReturnType<typeof openAbortableGet> | undefined;

            try {
                await createRule(origin, kind);
                heldClient = openAbortableGet(origin, catalogPath());
                await waitFor(async () => {
                    const snapshot = await state(origin);
                    expect(
                        snapshot.ledger.map((entry) => entry.status)
                    ).toContain(lifecycleStatus);
                });

                let shutdownState: PerformanceControlState | null | undefined;
                const applicationShutdown = app.shutdown.bind(app);
                app.shutdown = () => {
                    shutdownState = applicationShutdown();
                    return shutdownState;
                };
                const shutdown = createXtreamMockServerShutdown(server, app);
                const first = shutdown();
                const second = shutdown();

                expect(second).toBe(first);
                await within(first, 2_000);
                await within(heldClient.completed, 2_000);
                expect(shutdownState).toMatchObject({
                    heldIds: [],
                    heldCount: 0,
                    rules: [],
                    occurrences: [],
                    ledger: [],
                });

                const rebound = createServer(
                    (_request, response: ServerResponse) => response.end('ok')
                );
                try {
                    await listen(rebound, address.port);
                } finally {
                    await close(rebound);
                }
            } finally {
                heldClient?.abort();
                server.closeAllConnections();
                if (server.listening) await close(server);
            }
        }
    );
});

async function createRule(
    origin: string,
    kind: 'barrier' | 'delay'
): Promise<void> {
    const result = await postJson(
        origin,
        kind === 'barrier' ? '/__control/barriers' : '/__control/delays',
        TOKEN,
        {
            id: `shutdown-${kind}`,
            match: {
                scenario: 'performance-100k',
                transport: 'direct',
                action: 'get_live_streams',
                occurrence: 1,
                categoryId: '91101',
            },
            ...(kind === 'delay' ? { milliseconds: 5_000 } : {}),
        }
    );
    expect(result.response.status).toBe(201);
}

async function state(origin: string): Promise<PerformanceControlState> {
    const result = await requestJson(origin, '/__control/state', {
        headers: AUTH_HEADERS,
    });
    expect(result.response.status).toBe(200);
    return result.body as PerformanceControlState;
}

function catalogPath(): string {
    return '/player_api.php?username=performance&password=performance&action=get_live_streams&category_id=91101';
}

function listen(server: Server, port = 0): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
}

function close(server: Server): Promise<void> {
    return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
}

async function within<T>(
    promise: Promise<T>,
    milliseconds: number
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () => reject(new Error('operation exceeded deadline')),
                    milliseconds
                );
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
