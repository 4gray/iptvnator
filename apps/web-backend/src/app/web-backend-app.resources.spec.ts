import express from 'express';
import { gzipSync } from 'node:zlib';
import { HostConnectivityGuard } from '@iptvnator/shared/host-health';
import { createWebBackendApp } from './web-backend-app';
import { ProviderTargetRegistry } from './provider-target-registry';
import { providerResponseLimitBytes } from './provider-response';
import {
    registerProviderTarget,
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from './web-backend-app.spec-helpers';

describe('provider resource boundaries', () => {
    it('closes a still-streaming provider connection when its body exceeds the cap', async () => {
        let closed!: () => void;
        const disconnected = new Promise<void>((resolve) => {
            closed = resolve;
        });
        const provider = express().use((_req, res) => {
            res.write(Buffer.alloc(64));
            const timer = setInterval(() => res.write(Buffer.alloc(64)), 5);
            res.once('close', () => {
                clearInterval(timer);
                closed();
            });
        });
        await withServer(provider, async (url) => {
            await withServer(
                createWebBackendApp({
                    allowPrivateNetworkTargets: true,
                    maxProviderResponseBytes: 128,
                }),
                async (backend) => {
                    const id = await registerProviderTarget(backend, url);
                    expect(
                        (await fetch(`${backend}/parse?targetId=${id}`)).status
                    ).toBe(413);
                    await disconnected;
                }
            );
        });
    });

    it.each(['/parse', '/parse-xml', '/xtream', '/stalker'])(
        '%s rejects oversized final bodies while keeping the host reachable',
        async (route) => {
            const provider = express().use((_req, res) =>
                res.end('x'.repeat(129))
            );
            const guard = new HostConnectivityGuard();
            await withServer(provider, async (url) => {
                await withServer(
                    createWebBackendApp({
                        allowPrivateNetworkTargets: true,
                        maxProviderResponseBytes: 128,
                        hostGuard: guard,
                    }),
                    async (backend) => {
                        const id = await registerProviderTarget(backend, url);
                        for (let attempt = 0; attempt < 3; attempt++) {
                            const response = await fetch(
                                `${backend}${route}?targetId=${id}`
                            );
                            expect(response.status).toBe(
                                route.startsWith('/parse') ? 413 : 200
                            );
                            await expect(
                                response.json()
                            ).resolves.toMatchObject({
                                status: 413,
                                code: 'PROVIDER_RESPONSE_TOO_LARGE',
                            });
                        }
                    }
                );
            });
        }
    );

    it('rejects an oversized XML guide after explicit gzip decompression', async () => {
        const provider = express().get('/guide.gz', (_req, res) =>
            res.end(gzipSync('x'.repeat(4096)))
        );
        await withServer(provider, async (url) => {
            await withServer(
                createWebBackendApp({
                    allowPrivateNetworkTargets: true,
                    maxProviderResponseBytes: 128,
                }),
                async (backend) => {
                    const id = await registerProviderTarget(
                        backend,
                        `${url}/guide.gz`
                    );
                    const response = await fetch(
                        `${backend}/parse-xml?targetId=${id}`
                    );
                    expect(response.status).toBe(413);
                    await expect(response.json()).resolves.toMatchObject({
                        code: 'PROVIDER_RESPONSE_TOO_LARGE',
                    });
                }
            );
        });
    });

    it('reports evicted targets without fetching, then accepts re-registration', async () => {
        const client = new StubHttpClient();
        await withServer(
            createWebBackendApp({
                httpClient: client,
                resolveHostname: resolvePublicHost,
                providerTargets: new ProviderTargetRegistry({ capacity: 1 }),
            }),
            async (backend) => {
                const first = await registerProviderTarget(
                    backend,
                    'https://one.test/list'
                );
                await registerProviderTarget(backend, 'https://two.test/list');
                const response = await fetch(
                    `${backend}/parse?targetId=${first}`
                );
                expect(response.status).toBe(404);
                await expect(response.json()).resolves.toMatchObject({
                    code: 'PROVIDER_TARGET_NOT_FOUND',
                });
                expect(client.requests).toHaveLength(0);
                expect(
                    await registerProviderTarget(
                        backend,
                        'https://one.test/list'
                    )
                ).toBe(first);
                client.queueResponse(
                    '#EXTM3U\n#EXTINF:-1,Channel\nhttps://media.test/live'
                );
                expect(
                    (await fetch(`${backend}/parse?targetId=${first}`)).status
                ).toBe(200);
            }
        );
    });

    it('reads an operator-selected response cap and ignores invalid values', () => {
        const previous = process.env['IPTVNATOR_MAX_PROVIDER_RESPONSE_MB'];
        try {
            process.env['IPTVNATOR_MAX_PROVIDER_RESPONSE_MB'] = '2';
            expect(providerResponseLimitBytes()).toBe(2 * 1024 * 1024);
            for (const invalid of ['0', '-1', 'NaN', 'Infinity']) {
                process.env['IPTVNATOR_MAX_PROVIDER_RESPONSE_MB'] = invalid;
                expect(providerResponseLimitBytes()).toBe(64 * 1024 * 1024);
            }
        } finally {
            if (previous === undefined)
                delete process.env['IPTVNATOR_MAX_PROVIDER_RESPONSE_MB'];
            else process.env['IPTVNATOR_MAX_PROVIDER_RESPONSE_MB'] = previous;
        }
    });
});
