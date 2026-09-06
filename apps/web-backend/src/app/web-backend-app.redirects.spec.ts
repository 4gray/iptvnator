import {
    HostConnectivityGuard,
    OPEN_DURATION_MS,
} from '@iptvnator/shared/host-health';
import { isHostConnectivityFastFailMessage } from '@iptvnator/shared/interfaces';
import axios from 'axios';
import express from 'express';
import { createWebBackendApp, WebBackendHttpClient } from './web-backend-app';
import {
    registerProviderTarget,
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from './web-backend-app.spec-helpers';

describe('provider proxy redirect boundary', () => {
    it.each(['/xtream', '/stalker', '/parse', '/parse-xml'])(
        '%s refuses a private redirect before contacting its destination',
        async (route) => {
            let destinationRequests = 0;
            const destination = express().get('/private', (_req, res) => {
                destinationRequests++;
                res.send('synthetic private response');
            });
            await withServer(destination, async (destinationUrl) => {
                const provider = express().use((_req, res) => {
                    res.redirect(`${destinationUrl}/private`);
                });
                await withServer(provider, async (providerUrl) => {
                    // Only the first public endpoint is mapped to a synthetic
                    // local provider. Axios and its redirect transport are real.
                    const httpClient: WebBackendHttpClient = {
                        get: (url, options) =>
                            axios.get(
                                new URL(url).hostname === 'provider.example'
                                    ? providerUrl
                                    : url,
                                options
                            ),
                    };
                    await withServer(
                        createWebBackendApp({
                            httpClient,
                            resolveHostname: resolvePublicHost,
                            allowPrivateNetworkTargets: false,
                        }),
                        async (backend) => {
                            const id = await registerProviderTarget(
                                backend,
                                'http://provider.example'
                            );
                            const response = await fetch(
                                `${backend}${route}?targetId=${id}`
                            );
                            const body = await response.json();
                            expect(destinationRequests).toBe(0);
                            expect(response.status).toBe(
                                route.startsWith('/parse') ? 400 : 200
                            );
                            expect(body).toEqual({
                                status: 400,
                                message:
                                    'Provider URL points to a private or local network address',
                            });
                        }
                    );
                });
            });
        }
    );
});

describe('redirect routes and admission lifecycle', () => {
    it.each(['/xtream', '/stalker', '/parse', '/parse-xml'])(
        '%s follows an allowed local redirect and parses the final body',
        async (route) => {
            const provider = express().use((req, res) => {
                if (req.path !== '/final') {
                    res.redirect('/final');
                    return;
                }
                if (route === '/parse')
                    res.send(
                        '#EXTM3U\n#EXTINF:-1,Test\nhttps://example.com/test.ts'
                    );
                else if (route === '/parse-xml')
                    res.type('xml').send(
                        '<?xml version="1.0"?><tv><channel id="test"><display-name>Test</display-name></channel></tv>'
                    );
                else res.json({ ok: true });
            });
            await withServer(provider, async (url) => {
                await withServer(
                    createWebBackendApp({ allowPrivateNetworkTargets: true }),
                    async (backend) => {
                        const id = await registerProviderTarget(backend, url);
                        const response = await fetch(
                            `${backend}${route}?targetId=${id}&action=test`
                        );
                        const body = await response.json();
                        expect(response.status).toBe(200);
                        if (route === '/parse')
                            expect(body).toMatchObject({ count: 1 });
                        else if (route === '/parse-xml')
                            expect(body).toHaveProperty('channels');
                        else
                            expect(body).toEqual({
                                action: 'test',
                                payload: { ok: true },
                            });
                    }
                );
            });
        }
    );
    it.each(['/xtream', '/stalker', '/parse', '/parse-xml'])(
        '%s rechecks a registered hostname before its initial connection',
        async (route) => {
            const transport = new StubHttpClient();
            const resolveHostname = jest
                .fn()
                .mockResolvedValueOnce(['93.184.216.34'])
                .mockResolvedValue(['127.0.0.1']);
            await withServer(
                createWebBackendApp({ httpClient: transport, resolveHostname }),
                async (backend) => {
                    const id = await registerProviderTarget(
                        backend,
                        'https://provider.example'
                    );
                    const response = await fetch(
                        `${backend}${route}?targetId=${id}`
                    );
                    expect(response.status).toBe(
                        route.startsWith('/parse') ? 400 : 200
                    );
                    expect(await response.json()).toMatchObject({
                        status: 400,
                    });
                    expect(transport.requests).toHaveLength(0);
                }
            );
        }
    );
    it.each(['/xtream', '/stalker'])(
        '%s keeps query-only redirect failures off the initial endpoint record',
        async (route) => {
            const transport = new StubHttpClient();
            const networkFailure = () =>
                Object.assign(
                    new Error('secret http://user:password@provider.example'),
                    { code: 'ENOTFOUND' }
                );
            transport.queueNetworkError(networkFailure());
            transport.queueRedirect('?next=1');
            transport.queueNetworkError(networkFailure());
            transport.queueNetworkError(networkFailure());
            transport.queueResponse({ ok: true });
            const guard = new HostConnectivityGuard();
            await withServer(
                createWebBackendApp({
                    httpClient: transport,
                    hostGuard: guard,
                    resolveHostname: resolvePublicHost,
                }),
                async (backend) => {
                    const id = await registerProviderTarget(
                        backend,
                        'https://provider.example'
                    );
                    const call = () =>
                        fetch(`${backend}${route}?targetId=${id}`);
                    await call();
                    const redirected = await call();
                    expect(await redirected.text()).not.toContain('secret');
                    await call();
                    expect(await (await call()).json()).toMatchObject({
                        payload: { ok: true },
                    });
                    expect(transport.requests).toHaveLength(5);
                }
            );
        }
    );
    it.each(['/xtream', '/stalker'])(
        '%s releases a half-open trial after redirect DNS refusal and counts initial DNS failures',
        async (route) => {
            let now = 1000;
            const guard = new HostConnectivityGuard({ now: () => now });
            const transport = new StubHttpClient();
            let failDns = false;
            const resolveHostname = async (hostname: string) => {
                if (failDns || hostname === 'blocked.example')
                    throw Object.assign(new Error('secret transport details'), {
                        code: 'ENOTFOUND',
                    });
                return ['93.184.216.34'];
            };
            await withServer(
                createWebBackendApp({
                    httpClient: transport,
                    hostGuard: guard,
                    resolveHostname,
                }),
                async (backend) => {
                    const id = await registerProviderTarget(
                        backend,
                        'https://provider.example'
                    );
                    const call = () =>
                        fetch(`${backend}${route}?targetId=${id}`);
                    failDns = true;
                    await call();
                    await call();
                    const refused = (await (await call()).json()) as {
                        message: string;
                    };
                    expect(
                        isHostConnectivityFastFailMessage(refused.message)
                    ).toBe(true);
                    expect(transport.requests).toHaveLength(0);
                    now += OPEN_DURATION_MS + 1;
                    failDns = false;
                    transport.queueRedirect('https://blocked.example/next');
                    const trial = await call();
                    expect(await trial.json()).toEqual({
                        status: 400,
                        message: 'Provider URL host could not be resolved',
                    });
                    transport.queueResponse({ ok: true });
                    expect(await (await call()).json()).toMatchObject({
                        payload: { ok: true },
                    });
                }
            );
        }
    );
});
