import express from 'express';
import { createWebBackendApp } from './web-backend-app';
import {
    registerProviderTarget,
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from './web-backend-app.spec-helpers';

describe('hosted playlist responses', () => {
    it.each([false, true])(
        'keeps the tunnel open and returns JSON after a delayed provider response (oversized: %s)',
        async (oversized) => {
            const finish: Array<() => void> = [];
            const provider = express().get('/synthetic.m3u', (_req, res) => {
                finish.push(() =>
                    res.send(
                        oversized
                            ? 'x'.repeat(2048)
                            : '#EXTM3U\n#EXTINF:-1,Synthetic <channel>\nhttps://media.test/live'
                    )
                );
            });
            await withServer(provider, async (origin) => {
                const app = createWebBackendApp({
                    allowPrivateNetworkTargets: true,
                    hostedMode: 'cloudflare',
                    maxProviderResponseBytes: 1024,
                });
                await withServer(app, async (backend) => {
                    const id = await registerProviderTarget(
                        backend,
                        `${origin}/synthetic.m3u`
                    );
                    const legacy = oversized
                        ? fetch(`${backend}/parse?targetId=${id}`, {
                              signal: AbortSignal.timeout(18_000),
                          })
                        : undefined;
                    const response = await fetch(
                        `${backend}/parse?targetId=${id}&keepAlive=1`,
                        {
                            signal: AbortSignal.timeout(18_000),
                        }
                    );
                    const reader = response.body!.getReader();
                    const first = await reader.read();
                    expect(Buffer.from(first.value!).toString()).toMatch(
                        /^\s+$/
                    );
                    expect(response.headers.get('cache-control')).toContain(
                        'no-transform'
                    );
                    expect(finish).toHaveLength(oversized ? 2 : 1);
                    for (const complete of finish) complete();
                    const chunks: Uint8Array[] = [];
                    for (
                        let chunk = await reader.read();
                        !chunk.done;
                        chunk = await reader.read()
                    ) {
                        chunks.push(chunk.value);
                    }
                    const json = Buffer.concat(chunks).toString();
                    expect(response.status).toBe(200);
                    expect(json).not.toMatch(/[<>&]/);
                    expect(JSON.parse(json)).toMatchObject(
                        oversized
                            ? {
                                  status: 413,
                                  code: 'PROVIDER_RESPONSE_TOO_LARGE',
                              }
                            : {
                                  playlist: {
                                      items: [{ name: 'Synthetic <channel>' }],
                                  },
                              }
                    );
                    if (legacy) {
                        const response = await legacy;
                        expect(response.status).toBe(413);
                        await expect(response.json()).resolves.toMatchObject({
                            code: 'PROVIDER_RESPONSE_TOO_LARGE',
                        });
                    }
                });
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
            await withServer(app, async (backend) => {
                const id = await registerProviderTarget(
                    backend,
                    'https://provider.test/synthetic.m3u'
                );
                const response = await fetch(
                    `${backend}/parse?targetId=${id}${query}`
                );
                expect(response.status).toBe(403);
                await expect(response.json()).resolves.toMatchObject({
                    status: 403,
                });
            });
        }
    );

    it('closes the provider request when the playlist client disconnects', async () => {
        let markStarted!: () => void;
        let markClosed!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const closed = new Promise<void>((resolve) => {
            markClosed = resolve;
        });
        const provider = express().get('/synthetic.m3u', (_req, res) => {
            res.once('close', markClosed);
            markStarted();
        });
        await withServer(provider, async (origin) => {
            const app = createWebBackendApp({
                allowPrivateNetworkTargets: true,
                hostedMode: 'cloudflare',
            });
            await withServer(app, async (backend) => {
                const id = await registerProviderTarget(
                    backend,
                    `${origin}/synthetic.m3u`
                );
                const abort = new AbortController();
                const response = fetch(
                    `${backend}/parse?targetId=${id}&keepAlive=1`,
                    { signal: abort.signal }
                );
                const rejected = expect(response).rejects.toMatchObject({
                    name: 'AbortError',
                });
                await started;
                abort.abort();
                await Promise.all([rejected, closed]);
            });
        });
    });
});
