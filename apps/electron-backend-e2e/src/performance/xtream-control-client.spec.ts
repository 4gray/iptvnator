import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
    XtreamControlState,
    XtreamPerformanceManifest,
} from './xtream-benchmark-contract';
import { createXtreamControlClient } from './xtream-control-client';

const TOKEN = 'never-persist-this-control-token';
const MANIFEST: XtreamPerformanceManifest = {
    epoch: 1,
    scenario: 'performance-100k',
    seed: 91_001,
    counts: {
        categories: { live: 60, vod: 20, series: 20, total: 100 },
        items: {
            live: 60_000,
            vod: 20_000,
            series: 20_000,
            total: 100_000,
        },
    },
    bytes: 100,
    catalogSha256:
        'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
};
const STATE: XtreamControlState = {
    epoch: 1,
    prepared: MANIFEST,
    rules: [],
    heldIds: [],
    heldCount: 0,
    occurrences: [],
    ledger: [],
};

describe('Xtream performance control client', () => {
    it('exposes only fixed prepare, reset, and state operations', async () => {
        const calls: RecordedCall[] = [];
        const client = createXtreamControlClient({
            origin: 'http://127.0.0.1:43123',
            token: TOKEN,
            fetchImpl: fakeFetch(calls),
        });

        assert.deepEqual(Object.keys(client).sort(), [
            'prepare',
            'resetAll',
            'resetObservations',
            'state',
        ]);
        assert.deepEqual(await client.prepare(), MANIFEST);
        await client.resetObservations();
        await client.resetAll();
        assert.deepEqual(await client.state(), STATE);

        assert.deepEqual(
            calls.map(({ body, method, path }) => ({ body, method, path })),
            [
                {
                    body: { scenario: 'performance-100k' },
                    method: 'POST',
                    path: '/__control/prepare',
                },
                {
                    body: { mode: 'observations' },
                    method: 'POST',
                    path: '/__control/reset',
                },
                {
                    body: { mode: 'all' },
                    method: 'POST',
                    path: '/__control/reset',
                },
                {
                    body: null,
                    method: 'GET',
                    path: '/__control/state',
                },
            ]
        );
        assert.ok(
            calls.every(
                ({ headers, redirect }) =>
                    redirect === 'error' &&
                    headers.get('x-iptvnator-performance-token') === TOKEN
            )
        );
        assert.equal(
            calls.at(-1)?.headers.get('content-type'),
            null,
            'GET must not carry a synthetic JSON body'
        );
    });

    it('keeps the token closure-only and redacts transport failures', async () => {
        const client = createXtreamControlClient({
            origin: 'http://127.0.0.1:43123',
            token: TOKEN,
            fetchImpl: async () =>
                new Response(
                    JSON.stringify({
                        error: TOKEN,
                        password: 'performance',
                    }),
                    { status: 500 }
                ),
        });

        assert.doesNotMatch(JSON.stringify(client), new RegExp(TOKEN));
        await assert.rejects(
            () => client.prepare(),
            (error: unknown) =>
                error instanceof Error &&
                /prepare failed with HTTP 500/.test(error.message) &&
                !error.message.includes(TOKEN) &&
                !error.message.includes('performance')
        );
    });

    it('rejects redirects and a response finalized at any second origin', async () => {
        let forwardedToken = false;
        const client = createXtreamControlClient({
            origin: 'http://127.0.0.1:43123',
            token: TOKEN,
            fetchImpl: async (_input, init) => {
                if (init?.redirect !== 'error') {
                    forwardedToken = new Headers(init?.headers).has(
                        'x-iptvnator-performance-token'
                    );
                }
                return responseAt(
                    MANIFEST,
                    200,
                    'http://127.0.0.1:43124/__control/prepare'
                );
            },
        });

        await assert.rejects(
            () => client.prepare(),
            /redirect|origin|transport failed/
        );
        assert.equal(forwardedToken, false);
    });

    it('validates control responses without echoing their unsafe payloads', async () => {
        const client = createXtreamControlClient({
            origin: 'http://127.0.0.1:43123',
            token: TOKEN,
            fetchImpl: async () =>
                responseAt(
                    {
                        username: 'performance',
                        secret: TOKEN,
                    },
                    200,
                    'http://127.0.0.1:43123/__control/state'
                ),
        });

        await assert.rejects(
            () => client.state(),
            (error: unknown) =>
                error instanceof Error &&
                /invalid control response/.test(error.message) &&
                !error.message.includes(TOKEN) &&
                !error.message.includes('performance')
        );
    });

    it('sanitizes adversarial response metadata accessors', async () => {
        for (const property of ['ok', 'status', 'redirected', 'url'] as const) {
            const client = createXtreamControlClient({
                origin: 'http://127.0.0.1:43123',
                token: TOKEN,
                fetchImpl: async (input) => {
                    const response = {
                        json: async () => MANIFEST,
                        ok: property === 'status' ? false : true,
                        redirected: false,
                        status: 200,
                        url: String(input),
                    };
                    Object.defineProperty(response, property, {
                        get() {
                            throw new Error(TOKEN);
                        },
                    });
                    return response as Response;
                },
            });

            await assert.rejects(
                () => client.prepare(),
                (error: unknown) =>
                    error instanceof Error &&
                    /invalid response metadata/.test(error.message) &&
                    !error.message.includes(TOKEN)
            );
        }
    });

    it('sanitizes reset response Proxy failures', async () => {
        const resetBody = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error(TOKEN);
                },
            }
        );
        const client = createXtreamControlClient({
            origin: 'http://127.0.0.1:43123',
            token: TOKEN,
            fetchImpl: async (input) =>
                ({
                    json: async () => resetBody,
                    ok: true,
                    redirected: false,
                    status: 200,
                    url: String(input),
                }) as Response,
        });

        await assert.rejects(
            () => client.resetAll(),
            (error: unknown) =>
                error instanceof Error &&
                error.message === 'Xtream all reset invalid control response' &&
                !error.message.includes(TOKEN)
        );
    });

    it('rejects non-loopback origins and empty tokens before issuing I/O', () => {
        let calls = 0;
        const fetchImpl: typeof fetch = async () => {
            calls += 1;
            return new Response();
        };

        assert.throws(
            () =>
                createXtreamControlClient({
                    origin: 'https://provider.example',
                    token: TOKEN,
                    fetchImpl,
                }),
            /exact Xtream HTTP loopback origin/
        );
        assert.throws(
            () =>
                createXtreamControlClient({
                    origin: 'http://127.0.0.1:43123',
                    token: '',
                    fetchImpl,
                }),
            /non-empty control token/
        );
        assert.equal(calls, 0);
    });

    it('snapshots the validated origin and token before mutable getters can change them', async () => {
        const calls: RecordedCall[] = [];
        let currentOrigin = 'http://127.0.0.1:43123';
        let currentToken = TOKEN;
        let originReads = 0;
        let tokenReads = 0;
        const client = createXtreamControlClient({
            fetchImpl: fakeFetch(calls),
            get origin() {
                originReads += 1;
                return currentOrigin;
            },
            get token() {
                tokenReads += 1;
                return currentToken;
            },
        });

        currentOrigin = 'https://provider.example';
        currentToken = 'attacker-controlled-token';
        await client.prepare();

        assert.equal(originReads, 1);
        assert.equal(tokenReads, 1);
        assert.equal(calls[0]?.path, '/__control/prepare');
        assert.equal(
            calls[0]?.headers.get('x-iptvnator-performance-token'),
            TOKEN
        );
    });

    it('rejects invalid runtime token values before issuing I/O', () => {
        let calls = 0;
        const fetchImpl: typeof fetch = async () => {
            calls += 1;
            return new Response();
        };

        for (const token of [
            null,
            undefined,
            42,
            {},
            ' ',
            'line\r\nbreak',
            'x'.repeat(257),
        ]) {
            assert.throws(
                () =>
                    createXtreamControlClient({
                        origin: 'http://127.0.0.1:43123',
                        token,
                        fetchImpl,
                    } as unknown as Parameters<
                        typeof createXtreamControlClient
                    >[0]),
                /non-empty control token/
            );
        }
        assert.equal(calls, 0);
    });
});

interface RecordedCall {
    readonly body: Record<string, unknown> | null;
    readonly headers: Headers;
    readonly method: string;
    readonly path: string;
    readonly redirect: RequestRedirect | undefined;
}

function fakeFetch(calls: RecordedCall[]): typeof fetch {
    return async (input, init) => {
        const url = new URL(
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url
        );
        const method = init?.method ?? 'GET';
        const body =
            typeof init?.body === 'string'
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : null;
        calls.push({
            body,
            headers: new Headers(init?.headers),
            method,
            path: url.pathname,
            redirect: init?.redirect,
        });
        if (url.pathname.endsWith('/prepare')) {
            return responseAt(MANIFEST, 200, url.href);
        }
        if (url.pathname.endsWith('/reset')) {
            return responseAt(
                {
                    epoch: MANIFEST.epoch,
                    mode: body?.['mode'],
                },
                200,
                url.href
            );
        }
        return responseAt(STATE, 200, url.href);
    };
}

function responseAt(value: unknown, status: number, url: string): Response {
    const response = Response.json(value, { status });
    Object.defineProperty(response, 'url', { value: url });
    return response;
}
