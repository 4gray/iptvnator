import { createWebBackendApp } from './web-backend-app';
import {
    registerProviderTarget,
    resolvePublicHost,
    STALKER_IDENTITY_HEADERS,
    StubHttpClient,
    withServer,
} from './web-backend-app.spec-helpers';

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
                        timeout: 30000,
                        url: 'https://provider.example/list.m3u',
                    },
                ]);
            }
        );
    });

    it.each(['  IPTVnator-Test/1.0  ', '', '   '])(
        'forwards and persists the optional playlist User-Agent: %s',
        async (userAgent) => {
            const httpClient = new StubHttpClient();
            httpClient.queueResponse('#EXTM3U');
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
                    const params = new URLSearchParams({ targetId, userAgent });
                    const response = await fetch(`${baseUrl}/parse?${params}`);
                    expect(response.status).toBe(200);
                    const body = (await response.json()) as {
                        userAgent?: string;
                    };
                    const expected = userAgent.trim() || undefined;
                    expect(httpClient.requests[0].headers?.['User-Agent']).toBe(
                        expected
                    );
                    expect(body.userAgent).toBe(expected);
                }
            );
        }
    );

    it('parses XMLTV metadata into the current EPG shape', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse(`<?xml version="1.0"?>
<tv source-info-name="Fixture Guide">
  <channel id="news">
    <display-name lang="en">News</display-name>
    <icon src="https://example.test/news.png" width="100" height="50" />
    <url system="homepage">https://example.test/news</url>
  </channel>
  <programme start="20260811010000 +0000" stop="20260811020000 +0000" channel="news">
    <title lang="en">Morning News</title>
    <desc lang="en">Headlines</desc>
    <icon src="https://example.test/program.png" />
  </programme>
</tv>`);

        await withServer(
            createWebBackendApp({
                clientOrigins: ['http://localhost:4200'],
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'https://provider.example/guide.xml'
                );
                const response = await fetch(
                    `${baseUrl}/parse-xml?targetId=${targetId}`,
                    { headers: { Origin: 'http://localhost:4200' } }
                );
                const body = (await response.json()) as Record<string, unknown>;

                expect(response.status).toBe(200);
                expect(body).toMatchObject({
                    sourceInfoName: 'Fixture Guide',
                    channels: [
                        {
                            id: 'news',
                            displayName: [{ lang: 'en', value: 'News' }],
                            icon: [
                                {
                                    src: 'https://example.test/news.png',
                                    width: '100',
                                    height: '50',
                                },
                            ],
                            url: [
                                {
                                    system: 'homepage',
                                    value: 'https://example.test/news',
                                },
                            ],
                        },
                    ],
                    programs: [
                        {
                            channel: 'news',
                            start: '2026-08-11T01:00:00.000Z',
                            stop: '2026-08-11T02:00:00.000Z',
                            title: [{ lang: 'en', value: 'Morning News' }],
                            desc: [{ lang: 'en', value: 'Headlines' }],
                            icon: [
                                {
                                    src: 'https://example.test/program.png',
                                },
                            ],
                        },
                    ],
                });
                expect(httpClient.requests).toEqual([
                    {
                        headers: undefined,
                        params: undefined,
                        timeout: 30000,
                        url: 'https://provider.example/guide.xml',
                    },
                ]);
            }
        );
    });

    it('extracts KODIPROP ClearKey DRM on the /parse URL-import path', async () => {
        const httpClient = new StubHttpClient();
        const kid = '00112233445566778899aabbccddeeff';
        const key = 'ffeeddccbbaa99887766554433221100';
        // First channel uses the KODIPROP-before-#EXTINF layout (supported
        // since the 0.15.2-iptvnator.2 parser pin), the second the common
        // between-#EXTINF-and-URL layout.
        httpClient.queueResponse(`#EXTM3U
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=${kid}:${key}
#EXTINF:-1 tvg-id="ck" group-title="DASH",Encrypted DASH
https://stream.example/enc.mpd
#EXTINF:-1 tvg-id="ck2" group-title="DASH",Encrypted DASH 2
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=${kid}:${key}
https://stream.example/enc2.mpd
#EXTINF:-1 tvg-id="plain",Plain Channel
https://stream.example/live.m3u8`);

        await withServer(
            createWebBackendApp({
                clientOrigins: ['http://localhost:4200'],
                guid: () => 'fixed-id',
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'https://provider.example/drm.m3u'
                );
                const response = await fetch(
                    `${baseUrl}/parse?targetId=${targetId}`,
                    { headers: { Origin: 'http://localhost:4200' } }
                );
                const body = (await response.json()) as {
                    playlist: { items: Array<Record<string, unknown>> };
                };

                expect(response.status).toBe(200);
                expect(body.playlist.items).toHaveLength(3);
                expect(body.playlist.items[0]['drm']).toEqual({
                    licenseType: 'clearkey',
                    supported: true,
                    clearKeys: { [kid]: key },
                });
                expect(body.playlist.items[1]['drm']).toEqual({
                    licenseType: 'clearkey',
                    supported: true,
                    clearKeys: { [kid]: key },
                });
                expect(body.playlist.items[2]['drm']).toBeUndefined();
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
                        timeout: 30000,
                        url: 'http://xtream.example/player_api.php',
                    },
                ]);
            }
        );
    });

    it('normalizes full Xtream API target URLs before proxying', async () => {
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
                    'http://xtream.example/panel/player_api.php?username=old&password=old'
                );
                const response = await fetch(
                    `${baseUrl}/xtream?targetId=${targetId}&username=%20demo%20&password=%20secret%20&action=get_account_info`
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
                        timeout: 30000,
                        url: 'http://xtream.example/panel/player_api.php',
                    },
                ]);
            }
        );
    });

    it('proxies Stalker requests with the full STB identity and no credentials in the portal query', async () => {
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
                // MAC and token travel ONLY as Cookie/Authorization — the
                // portal query carries protocol params plus the JsHttpRequest
                // marker every real client sends.
                expect(httpClient.requests).toEqual([
                    {
                        headers: {
                            ...STALKER_IDENTITY_HEADERS,
                            Authorization: 'Bearer abc123',
                            Cookie: 'mac=00:1A:79:00:00:01; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin',
                        },
                        params: undefined,
                        timeout: 15000,
                        url: 'http://stalker.example/portal.php?action=get_categories&type=vod&JsHttpRequest=1-xml',
                    },
                ]);
            }
        );
    });

    it('sends the SN header, cfduid cookie, and get_profile sn param for a stored serial', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ js: { status: 0 } });
        httpClient.queueResponse({ js: [] });

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
                await fetch(
                    `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01&token=abc123&serialNumber=SN1234&type=stb&action=get_profile`
                );
                // A non-profile action must not carry the serial as a query
                // param even when the renderer sends a stale `sn`.
                await fetch(
                    `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01&token=abc123&serialNumber=SN1234&type=itv&action=get_ordered_list&sn=SN1234`
                );

                const [profileRequest, listRequest] = httpClient.requests;
                expect(profileRequest.headers).toMatchObject({
                    SN: 'SN1234',
                });
                expect(profileRequest.headers?.['Cookie']).toContain(
                    '__cfduid='
                );
                expect(profileRequest.url).toBe(
                    'http://stalker.example/portal.php?type=stb&action=get_profile&sn=SN1234&JsHttpRequest=1-xml'
                );

                expect(listRequest.headers).toMatchObject({ SN: 'SN1234' });
                expect(listRequest.url).toBe(
                    'http://stalker.example/portal.php?type=itv&action=get_ordered_list&JsHttpRequest=1-xml'
                );
                for (const request of httpClient.requests) {
                    expect(request.url).not.toContain('serialNumber');
                    expect(request.url).not.toContain('macAddress');
                    expect(request.url).not.toContain('token=');
                }
            }
        );
    });

    it('keeps the presented handshake token in the portal query', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ js: { token: 'FRESH' } });

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
                // Handshake is the one action whose token is protocol
                // content: the portal reads the candidate from the query and
                // returns it unchanged when it is still valid.
                await fetch(
                    `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01&token=CACHEDTOKEN123&type=stb&action=handshake`
                );

                expect(httpClient.requests[0].url).toBe(
                    'http://stalker.example/portal.php?type=stb&action=handshake&token=CACHEDTOKEN123&JsHttpRequest=1-xml'
                );
                expect(httpClient.requests[0].headers).toMatchObject({
                    Authorization: 'Bearer CACHEDTOKEN123',
                });
            }
        );
    });

    it('omits the session cookie when no MAC is supplied', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ js: [] });

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
                await fetch(
                    `${baseUrl}/stalker?targetId=${targetId}&action=get_categories`
                );

                expect(httpClient.requests[0].headers).not.toHaveProperty(
                    'Cookie'
                );
                expect(httpClient.requests[0].headers).toMatchObject(
                    STALKER_IDENTITY_HEADERS
                );
            }
        );
    });

    it('forwards Stalker cmd in the reference wire format instead of axios encoding', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ js: { cmd: 'http://cdn/stream.m3u8' } });

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
                // The PWA renderer sends fully URLSearchParams-encoded values;
                // Express decodes them back to the stored cmd string.
                const query = new URLSearchParams({
                    targetId,
                    macAddress: '00:1A:79:00:00:01',
                    action: 'create_link',
                    type: 'itv',
                    cmd: 'ffrt3 http://host/ch/123?token=a%3Ab c&x=1',
                });
                const response = await fetch(
                    `${baseUrl}/stalker?${query.toString()}`
                );
                await response.json();

                // Slashes stay raw and pre-encoded sequences pass through
                // untouched (no %25 double-encoding); '&' inside cmd cannot
                // append query parameters. The whole query is built by the
                // shared URL builder, so nothing rides in axios params.
                expect(httpClient.requests).toEqual([
                    {
                        headers: {
                            ...STALKER_IDENTITY_HEADERS,
                            Cookie: 'mac=00:1A:79:00:00:01; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin',
                        },
                        params: undefined,
                        // `create_link` takes the longer budget: the portal
                        // mints a stream URL before it answers.
                        timeout: 30000,
                        url:
                            'http://stalker.example/portal.php' +
                            '?action=create_link&type=itv' +
                            '&cmd=ffrt3%20http://host/ch/123?token=a%3Ab%20c%26x=1' +
                            '&JsHttpRequest=1-xml',
                    },
                ]);
            }
        );
    });

    it('keeps cmd in the query when the registered portal URL carries a fragment or bare ?', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse({ js: { cmd: 'http://cdn/a.m3u8' } });
        httpClient.queueResponse({ js: { cmd: 'http://cdn/b.m3u8' } });

        await withServer(
            createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                // A fragment on the registered URL must not swallow the
                // appended cmd (fragments are never sent to the portal).
                const fragmentTarget = await registerProviderTarget(
                    baseUrl,
                    'http://stalker.example/portal.php#legacy'
                );
                await fetch(
                    `${baseUrl}/stalker?targetId=${fragmentTarget}&action=create_link&cmd=${encodeURIComponent('/media/1.mpg')}`
                );

                // A trailing bare '?' must not produce '??cmd='.
                const bareQueryTarget = await registerProviderTarget(
                    baseUrl,
                    'http://stalker.example/load.php?'
                );
                await fetch(
                    `${baseUrl}/stalker?targetId=${bareQueryTarget}&action=create_link&cmd=${encodeURIComponent('/media/2.mpg')}`
                );

                expect(
                    httpClient.requests.map((request) => request.url)
                ).toEqual([
                    'http://stalker.example/portal.php?action=create_link&cmd=/media/1.mpg&JsHttpRequest=1-xml',
                    'http://stalker.example/load.php?action=create_link&cmd=/media/2.mpg&JsHttpRequest=1-xml',
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

    it('surfaces happy-eyeballs network codes on xtream failures', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(
            Object.assign(
                new AggregateError([
                    Object.assign(
                        new Error('connect ETIMEDOUT 104.21.0.1:80'),
                        { code: 'ETIMEDOUT' }
                    ),
                    Object.assign(
                        new Error('connect ENETUNREACH 2606:4700::1:80'),
                        { code: 'ENETUNREACH' }
                    ),
                ]),
                { code: 'ETIMEDOUT' }
            )
        );
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
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
                        `${baseUrl}/xtream?targetId=${targetId}&action=get_account_info&username=secret-user&password=secret-pass`
                    );

                    await expect(response.json()).resolves.toEqual({
                        message: 'Bad Gateway (ETIMEDOUT)',
                        status: 502,
                        code: 'ETIMEDOUT',
                    });
                }
            );

            expect(errorSpy).toHaveBeenCalledTimes(1);
            const logLine = errorSpy.mock.calls[0][0] as string;
            expect(logLine).toContain('/xtream');
            expect(logLine).toContain('xtream.example');
            expect(logLine).toContain('ETIMEDOUT, ENETUNREACH');
            expect(logLine).not.toContain('secret-user');
            expect(logLine).not.toContain('secret-pass');
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('surfaces network error codes on stalker failures', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(
            Object.assign(new Error('connect ENETUNREACH'), {
                code: 'ENETUNREACH',
            })
        );
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
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
                        `${baseUrl}/stalker?targetId=${targetId}&action=handshake`
                    );

                    await expect(response.json()).resolves.toEqual({
                        message: 'Bad Gateway (ENETUNREACH)',
                        status: 502,
                        code: 'ENETUNREACH',
                    });
                }
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('surfaces network error codes on playlist parse failures', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(
            Object.assign(new Error('connect ETIMEDOUT'), {
                code: 'ETIMEDOUT',
            })
        );
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
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

                    expect(response.status).toBe(500);
                    await expect(response.json()).resolves.toEqual({
                        message: 'Error, something went wrong (ETIMEDOUT)',
                        status: 500,
                        code: 'ETIMEDOUT',
                    });
                }
            );
        } finally {
            errorSpy.mockRestore();
        }
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

    it('rejects Xtream proxy calls when a registered target no longer passes the URL policy', async () => {
        const httpClient = new StubHttpClient();
        const resolvedAddresses = [['93.184.216.34'], ['127.0.0.1']];

        await withServer(
            createWebBackendApp({
                httpClient,
                resolveHostname: async () =>
                    resolvedAddresses.shift() ?? ['127.0.0.1'],
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const response = await fetch(
                    `${baseUrl}/xtream?targetId=${targetId}&action=get_account_info`
                );

                expect(response.status).toBe(200);
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
