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
        readonly status?: number;
        readonly statusText?: string;
    }> = [];

    queueResponse(data: unknown): void {
        this.queuedResponses.push({ data });
    }

    queueFailure(status: number, statusText = 'Provider failure'): void {
        this.queuedResponses.push({ data: null, status, statusText });
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
        httpClient.queueResponse(`#EXTM3U
#EXTINF:-1 tvg-id="news" group-title="News",News Channel
https://stream.example/news.m3u8`);

        await withServer(
            createWebBackendApp({
                clientOrigins: ['http://localhost:4200'],
                guid: () => 'fixed-id',
                httpClient,
                now: () => new Date('2026-05-15T08:00:00.000Z'),
            }),
            async (baseUrl) => {
                const response = await fetch(
                    `${baseUrl}/parse?url=${encodeURIComponent('https://provider.example/list.m3u')}`,
                    { headers: { Origin: 'http://localhost:4200' } }
                );
                const body = (await response.json()) as {
                    playlist: { items: Array<Record<string, unknown>> };
                };

                expect(response.status).toBe(200);
                expect(response.headers.get('access-control-allow-origin')).toBe(
                    'http://localhost:4200'
                );
                expect(body).toMatchObject({
                    _id: 'fixed-id',
                    autoRefresh: false,
                    count: 1,
                    favorites: [],
                    filename: 'list.m3u',
                    id: 'fixed-id',
                    importDate: '2026-05-15T08:00:00.000Z',
                    lastUsage: '2026-05-15T08:00:00.000Z',
                    title: 'list.m3u',
                    url: 'https://provider.example/list.m3u',
                });
                expect(body.playlist.items).toHaveLength(1);
                expect(body.playlist.items[0]).toMatchObject({
                    id: 'fixed-id',
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

    it('proxies Xtream requests through the provider player API endpoint', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ user_info: { username: 'demo' } });

        await withServer(
            createWebBackendApp({ httpClient }),
            async (baseUrl) => {
                const response = await fetch(
                    `${baseUrl}/xtream?url=${encodeURIComponent('http://xtream.example')}&username=demo&password=secret&action=get_account_info`
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
            createWebBackendApp({ httpClient }),
            async (baseUrl) => {
                const response = await fetch(
                    `${baseUrl}/stalker?url=${encodeURIComponent('http://stalker.example/portal.php')}&macAddress=00:1A:79:00:00:01&token=abc123&action=get_categories&type=vod`
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
            createWebBackendApp({ httpClient }),
            async (baseUrl) => {
                const response = await fetch(
                    `${baseUrl}/xtream?url=${encodeURIComponent('http://xtream.example')}&action=get_account_info`
                );

                await expect(response.json()).resolves.toEqual({
                    message: 'Forbidden',
                    status: 403,
                });
            }
        );
    });
});
