import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import express from 'express';
import { streamTestServer } from './http-server.spec-helpers';
import {
    createWebBackendApp,
    type WebBackendHttpClient,
} from './web-backend-app';
import {
    registerProviderTarget,
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from './web-backend-app.spec-helpers';

const playlistUrl = 'https://provider.test/synthetic.m3u';

describe('hosted playlist responses', () => {
    it.each([false, true])(
        'keeps the tunnel open and returns JSON after a delayed provider response (oversized: %s)',
        async (oversized) => {
            const httpClient = new StubHttpClient();
            const providerBodies = [new PassThrough(), new PassThrough()];
            for (const body of providerBodies) httpClient.queueResponse(body);
            const app = createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
                hostedMode: 'cloudflare',
                maxProviderResponseBytes: 1024,
                guid: () => 'synthetic-id',
                now: () => new Date(0),
            });
            await withServer(app, async (backend, send, server) => {
                const id = await registerProviderTarget(
                    backend,
                    playlistUrl,
                    send
                );
                const userAgent = 'Synthetic <agent> & compatibility';
                const path = `/parse?${new URLSearchParams({ targetId: id, userAgent })}`;
                const signal = AbortSignal.timeout(18_000);
                const legacy = send(`${backend}${path}`, { signal });
                const response = await streamTestServer(
                    server,
                    backend,
                    `${path}&keepAlive=1`,
                    signal
                );
                const reader = response[Symbol.asyncIterator]();
                const first = await reader.next();
                assert(!first.done);
                expect(Buffer.from(first.value).toString()).toMatch(/^\s+$/);
                expect(response.headers['cache-control']).toContain(
                    'no-transform'
                );
                expect(response.headers['x-content-type-options']).toBe(
                    'nosniff'
                );
                expect(response.headers['content-type']).toBe(
                    'application/json; charset=utf-8'
                );
                expect(response.headers['content-security-policy']).toBe(
                    "sandbox; default-src 'none'"
                );
                expect(response.headers['x-iptvnator-json-heartbeat']).toBe(
                    '1'
                );
                const payload = oversized
                    ? 'x'.repeat(2048)
                    : '#EXTM3U\n#EXTINF:-1,Synthetic <channel>\nhttps://media.test/live?first=1&second=2';
                for (const body of providerBodies) body.end(payload);
                const chunks: Uint8Array[] = [];
                for (
                    let chunk = await reader.next();
                    !chunk.done;
                    chunk = await reader.next()
                ) {
                    chunks.push(chunk.value);
                }
                const json = Buffer.concat(chunks).toString();
                expect(response.statusCode).toBe(200);
                expect(JSON.parse(json)).toMatchObject(
                    oversized
                        ? { status: 413, code: 'PROVIDER_RESPONSE_TOO_LARGE' }
                        : {
                              userAgent,
                              playlist: {
                                  items: [{ name: 'Synthetic <channel>' }],
                              },
                          }
                );
                const ordinary = await legacy;
                expect(ordinary.status).toBe(oversized ? 413 : 200);
                expect(ordinary.headers.has('x-iptvnator-json-heartbeat')).toBe(
                    false
                );
                expect(json.trimStart()).toBe(await ordinary.text());
            });
        },
        22_000
    );

    it.each(['', '&keepAlive=1'])(
        'preserves the HTTP status for a provider error before a heartbeat (%s)',
        async (query) => {
            const httpClient = new StubHttpClient();
            httpClient.queueFailure(403);
            const app = createWebBackendApp({
                httpClient,
                hostedMode: 'cloudflare',
                resolveHostname: resolvePublicHost,
            });
            await withServer(app, async (backend, send) => {
                const id = await registerProviderTarget(
                    backend,
                    playlistUrl,
                    send
                );
                const response = await send(
                    `${backend}/parse?targetId=${id}${query}`
                );
                expect(response.status).toBe(403);
                await expect(response.json()).resolves.toMatchObject({
                    status: 403,
                });
            });
        }
    );

    it('cancels the provider request when the playlist client disconnects', async () => {
        let markStarted!: () => void;
        let markCancelled!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const cancelled = new Promise<void>((resolve) => {
            markCancelled = resolve;
        });
        const httpClient: WebBackendHttpClient = {
            async get(_url, { signal } = {}) {
                assert(signal);
                return new Promise<never>((_resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => {
                            markCancelled();
                            reject(signal.reason);
                        },
                        { once: true }
                    );
                    markStarted();
                });
            },
        };
        const app = createWebBackendApp({
            httpClient,
            resolveHostname: resolvePublicHost,
            hostedMode: 'cloudflare',
        });
        await withServer(app, async (backend, send) => {
            const id = await registerProviderTarget(backend, playlistUrl, send);
            const abort = new AbortController();
            const response = send(
                `${backend}/parse?targetId=${id}&keepAlive=1`,
                { signal: abort.signal }
            );
            const rejected = expect(response).rejects.toMatchObject({
                name: 'AbortError',
            });
            await started;
            abort.abort();
            await Promise.all([rejected, cancelled]);
        });
    });

    it('skips the provider when a playlist client disconnects before authorization completes', async () => {
        let release!: () => void;
        let started!: () => void;
        let closed!: () => void;
        const authorization = new Promise<void>((resolve) => {
            release = resolve;
        });
        const waiting = new Promise<void>((resolve) => {
            started = resolve;
        });
        const disconnect = new Promise<void>((resolve) => {
            closed = resolve;
        });
        const httpClient = new StubHttpClient();
        httpClient.queueResponse('#EXTM3U');
        const app = express();
        app.use('/parse', (_req, res, next) => {
            res.once('close', closed);
            started();
            void authorization.then(() => next());
        });
        app.use(
            createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
                hostedMode: 'cloudflare',
            })
        );
        await withServer(app, async (backend, send) => {
            const id = await registerProviderTarget(backend, playlistUrl, send);
            const abort = new AbortController();
            const response = send(
                `${backend}/parse?targetId=${id}&keepAlive=1`,
                { signal: abort.signal }
            );
            const rejected = expect(response).rejects.toMatchObject({
                name: 'AbortError',
            });
            await waiting;
            abort.abort();
            await Promise.all([rejected, disconnect]);
            release();
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(httpClient.requests).toHaveLength(0);
        });
    });
});
