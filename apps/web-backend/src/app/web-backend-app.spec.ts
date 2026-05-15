import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import {
    createWebBackendApp,
    WebBackendHttpClient,
    WebBackendHttpGetOptions,
} from './web-backend-app';

interface HttpRequest {
    readonly headers?: Record<string, string>;
    readonly params?: Record<string, string>;
    readonly responseData: unknown;
    readonly responseStatus?: number;
    readonly url: string;
}

class StubHttpClient implements WebBackendHttpClient {
    readonly requests: Omit<HttpRequest, 'responseData' | 'responseStatus'>[] =
        [];
    private readonly queuedResponses: Array<{
        readonly data: unknown;
        readonly error?: Error;
        readonly status?: number;
        readonly statusText?: string;
    }> = [];

    queueResponse(data: unknown): void {
        this.queuedResponses.push({ data });
    }

    queueFailure(status: number, statusText = 'Provider failure'): void {
        this.queuedResponses.push({ data: null, status, statusText });
    }

    queueNetworkFailure(message = 'connect ECONNREFUSED'): void {
        this.queuedResponses.push({ data: null, error: new Error(message) });
    }

    async get<T>(
        url: string,
        options: WebBackendHttpGetOptions = {}
    ): Promise<{ data: T }> {
        this.requests.push({
            headers: options.headers,
            params: options.params,
            url,
        });

        const response = this.queuedResponses.shift();
        if (!response) {
            throw new Error(`No queued response for ${url}`);
        }

        if (response.error) {
            throw response.error;
        }

        if (response.status) {
            const error = new Error(response.statusText) as Error & {
                response: { status: number; statusText: string };
            };
            error.response = {
                status: response.status,
                statusText: response.statusText ?? 'Provider failure',
            };
            throw error;
        }

        return { data: response.data as T };
    }
}

const resolvePublicHost = async () => ['93.184.216.34'];

async function registerProviderTarget(
    baseUrl: string,
    url: string
): Promise<string> {
    const response = await fetch(`${baseUrl}/provider-targets`, {
        body: JSON.stringify({ url }),
        headers: {
            'content-type': 'application/json',
        },
        method: 'POST',
    });
    const body = (await response.json()) as { targetId: string };
    return body.targetId;
}

async function withServer<T>(
    app: ReturnType<typeof createWebBackendApp>,
    callback: (baseUrl: string) => Promise<T>
): Promise<T> {
    const server = await new Promise<Server>((resolve) => {
        const started = app.listen(0, '127.0.0.1', () => resolve(started));
    });

    try {
        const address = server.address() as AddressInfo;
        return await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}

describe('web backend app', () => {
    it('exposes a health endpoint', async () => {
        await withServer(createWebBackendApp(), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/health`);

            await expect(response.json()).resolves.toEqual({
                status: 'ok',
                service: 'iptvnator-web-backend',
            });
        });
    });

    it('serves runtime config as executable JavaScript', async () => {
        await withServer(
            createWebBackendApp({
                runtimeBackendUrl: '/api',
            }),
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/config.js`);
                const body = await response.text();

                expect(response.headers.get('content-type')).toContain(
                    'application/javascript'
                );
                expect(body).toContain('window.__IPTVNATOR_CONFIG__');
                expect(body).toContain('"BACKEND_URL":"/api"');
            }
        );
    });

    it('parses remote M3U playlists into the PWA playlist shape', async () => {
        const httpClient = new StubHttpClient();
        let idCounter = 0;
        httpClient.queueResponse(`#EXTM3U
#EXTINF:-1 tvg-id="news" group-title="News",News Channel
https://stream.example/news.m3u8`);

        await withServer(
            createWebBackendApp({
                clientOrigins: ['http://localhost:4200'],
                guid: () => `fixed-id-${++idCounter}`,
                httpClient,
                now: () => new Date('2026-05-15T08:00:00.000Z'),
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'https://provider.example/list.m3u'
                );
                const response = await fetch(
                    `${baseUrl}/parse?targetId=${targetId}`,
                    { headers: { Origin: 'http://localhost:4200' } }
                );
                const body = (await response.json()) as {
                    playlist: { items: Array<Record<string, unknown>> };
                };

                expect(response.status).toBe(200);
                expect(
                    response.headers.get('access-control-allow-origin')
                ).toBe('http://localhost:4200');
                expect(body).toMatchObject({
                    _id: 'fixed-id-1',
                    autoRefresh: false,
                    count: 1,
                    favorites: [],
                    filename: 'list.m3u',
                    id: 'fixed-id-1',
                    importDate: '2026-05-15T08:00:00.000Z',
                    lastUsage: '2026-05-15T08:00:00.000Z',
                    title: 'list.m3u',
                    url: 'https://provider.example/list.m3u',
                });
                expect(body.playlist.items).toHaveLength(1);
                expect(body.playlist.items[0]).toMatchObject({
                    id: 'fixed-id-2',
                    name: 'News Channel',
                    url: 'https://stream.example/news.m3u8',
                });
                expect(httpClient.requests).toEqual([
                    {
                        headers: undefined,
                        params: undefined,
                        url: 'https://provider.example/list.m3u',
                    },
                ]);
            }
        );
    });

    it('allows browser preflight checks for provider target registration', async () => {
        await withServer(
            createWebBackendApp({
                clientOrigins: ['http://localhost:4200'],
            }),
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/provider-targets`, {
                    headers: {
                        'Access-Control-Request-Headers': 'content-type',
                        'Access-Control-Request-Method': 'POST',
                        Origin: 'http://localhost:4200',
                    },
                    method: 'OPTIONS',
                });

                expect(response.status).toBe(200);
                expect(
                    response.headers.get('access-control-allow-origin')
                ).toBe('http://localhost:4200');
            }
        );
    });

    it('proxies Xtream requests through the provider player API endpoint', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ user_info: { username: 'demo' } });

        await withServer(
            createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const response = await fetch(
                    `${baseUrl}/xtream?targetId=${targetId}&username=demo&password=secret&action=get_account_info`
                );

                await expect(response.json()).resolves.toEqual({
                    action: 'get_account_info',
                    payload: { user_info: { username: 'demo' } },
                });
                expect(httpClient.requests).toEqual([
                    {
                        headers: undefined,
                        params: {
                            action: 'get_account_info',
                            password: 'secret',
                            username: 'demo',
                        },
                        url: 'http://xtream.example/player_api.php',
                    },
                ]);
            }
        );
    });

    it('proxies Stalker requests with MAC cookie and bearer token', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ js: [{ id: '2001', title: 'Action' }] });

        await withServer(
            createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://stalker.example/portal.php'
                );
                const response = await fetch(
                    `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01&token=abc123&action=get_categories&type=vod`
                );

                await expect(response.json()).resolves.toEqual({
                    action: 'get_categories',
                    payload: { js: [{ id: '2001', title: 'Action' }] },
                });
                expect(httpClient.requests).toEqual([
                    {
                        headers: {
                            Authorization: 'Bearer abc123',
                            Cookie: 'mac=00:1A:79:00:00:01',
                        },
                        params: {
                            action: 'get_categories',
                            macAddress: '00:1A:79:00:00:01',
                            token: 'abc123',
                            type: 'vod',
                        },
                        url: 'http://stalker.example/portal.php',
                    },
                ]);
            }
        );
    });

    it('normalizes provider errors for portal proxy calls', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueFailure(403, 'Forbidden');

        await withServer(
            createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const response = await fetch(
                    `${baseUrl}/xtream?targetId=${targetId}&action=get_account_info`
                );

                await expect(response.json()).resolves.toEqual({
                    message: 'Forbidden',
                    status: 403,
                });
            }
        );
    });

    it('normalizes non-HTTP upstream failures as bad gateway', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkFailure();

        await withServer(
            createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const response = await fetch(
                    `${baseUrl}/xtream?targetId=${targetId}&action=get_account_info`
                );

                await expect(response.json()).resolves.toEqual({
                    message: 'Bad Gateway',
                    status: 502,
                });
            }
        );
    });

    it('returns provider parse errors as JSON instead of executable text', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueFailure(502, '<script>alert(1)</script>');

        await withServer(
            createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'https://provider.example/list.m3u'
                );
                const response = await fetch(
                    `${baseUrl}/parse?targetId=${targetId}`
                );

                expect(response.status).toBe(502);
                expect(response.headers.get('content-type')).toContain(
                    'application/json'
                );
                await expect(response.json()).resolves.toEqual({
                    message: '<script>alert(1)</script>',
                    status: 502,
                });
            }
        );
    });

    it('rejects unsupported target URL schemes before proxying', async () => {
        const httpClient = new StubHttpClient();

        await withServer(
            createWebBackendApp({ httpClient }),
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/provider-targets`, {
                    body: JSON.stringify({ url: 'file:///etc/passwd' }),
                    headers: {
                        'content-type': 'application/json',
                    },
                    method: 'POST',
                });

                expect(response.status).toBe(400);
                await expect(response.json()).resolves.toEqual({
                    message: 'Only http and https provider URLs are supported',
                    status: 400,
                });
                expect(httpClient.requests).toEqual([]);
            }
        );
    });

    it('rejects loopback target URLs by default', async () => {
        const httpClient = new StubHttpClient();

        await withServer(
            createWebBackendApp({ httpClient }),
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/provider-targets`, {
                    body: JSON.stringify({
                        url: 'http://127.0.0.1:3211',
                    }),
                    headers: {
                        'content-type': 'application/json',
                    },
                    method: 'POST',
                });

                expect(response.status).toBe(400);
                await expect(response.json()).resolves.toEqual({
                    message:
                        'Provider URL points to a private or local network address',
                    status: 400,
                });
                expect(httpClient.requests).toEqual([]);
            }
        );
    });

    it('allows private target URLs when explicitly enabled for local self-hosted testing', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ user_info: { username: 'demo' } });

        await withServer(
            createWebBackendApp({
                allowPrivateNetworkTargets: true,
                httpClient,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://127.0.0.1:3211'
                );
                const response = await fetch(
                    `${baseUrl}/xtream?targetId=${targetId}&username=demo&password=secret&action=get_account_info`
                );

                await expect(response.json()).resolves.toEqual({
                    action: 'get_account_info',
                    payload: { user_info: { username: 'demo' } },
                });
                expect(httpClient.requests[0]?.url).toBe(
                    'http://127.0.0.1:3211/player_api.php'
                );
            }
        );
    });

    it('requires portal proxy callers to use registered provider targets', async () => {
        const httpClient = new StubHttpClient();

        await withServer(
            createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const missingTargetResponse = await fetch(
                    `${baseUrl}/xtream?action=get_account_info`
                );
                const unknownTargetResponse = await fetch(
                    `${baseUrl}/xtream?targetId=missing&action=get_account_info`
                );

                expect(missingTargetResponse.status).toBe(400);
                await expect(missingTargetResponse.json()).resolves.toEqual({
                    message: 'Missing targetId',
                    status: 400,
                });

                expect(unknownTargetResponse.status).toBe(404);
                await expect(unknownTargetResponse.json()).resolves.toEqual({
                    message: 'Provider target not found',
                    status: 404,
                });
                expect(httpClient.requests).toEqual([]);
            }
        );
    });
});
