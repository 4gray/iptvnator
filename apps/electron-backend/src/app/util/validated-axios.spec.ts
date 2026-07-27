import axios from 'axios';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { LookupFunction } from 'node:net';
import { UnsafeUrlError } from '../events/url-safety';
import {
    requestWithValidatedRedirects,
    type ValidatedRequestAgentFactory,
} from './validated-axios';

jest.mock('axios', () => ({
    __esModule: true,
    default: jest.fn(),
}));

const axiosMock = axios as unknown as jest.Mock;

describe('requestWithValidatedRedirects', () => {
    const publicResolver = async () => ['93.184.216.34'];

    function createCapturingAgentFactory() {
        const lookups: LookupFunction[] = [];
        const factory: ValidatedRequestAgentFactory = {
            createHttpsAgent: jest.fn((lookup) => {
                if (!lookup) {
                    throw new Error('Expected a pinned lookup');
                }
                lookups.push(lookup);
                return new HttpsAgent({ lookup });
            }),
        };

        return { factory, lookups };
    }

    beforeEach(() => {
        axiosMock.mockReset();
    });

    it('rejects a redirect target that violates the URL policy', async () => {
        axiosMock.mockResolvedValueOnce({
            status: 302,
            headers: {
                location: 'http://169.254.169.254/latest/meta-data',
            },
        });

        await expect(
            requestWithValidatedRedirects(
                'https://example.com/player_api.php',
                { method: 'GET' },
                { resolveHostname: publicResolver }
            )
        ).rejects.toBeInstanceOf(UnsafeUrlError);
        expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    it('pins the socket lookup to the address validated by the URL policy', async () => {
        axiosMock.mockResolvedValueOnce({
            status: 200,
            headers: {},
            data: '#EXTM3U',
        });
        const { factory, lookups } = createCapturingAgentFactory();

        await requestWithValidatedRedirects(
            'https://epg.example/guide.xml',
            { agentFactory: factory, method: 'GET' },
            {
                resolveHostname: async () => ['93.184.216.34'],
            }
        );

        const requestConfig = axiosMock.mock.calls[0][0];
        const resolvedAddress = await new Promise<{
            address: string | LookupAddress[];
            family?: number;
        }>((resolve, reject) => {
            lookups[0](
                'epg.example',
                { all: false, family: 0 } as LookupOptions,
                (error, address, family) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve({ address, family });
                }
            );
        });

        expect(factory.createHttpsAgent).toHaveBeenCalledWith(
            lookups[0],
            new URL('https://epg.example/guide.xml')
        );
        expect(requestConfig.httpsAgent).toBeInstanceOf(HttpsAgent);
        expect(requestConfig).not.toHaveProperty('agentFactory');
        expect(resolvedAddress).toEqual({
            address: '93.184.216.34',
            family: 4,
        });
        expect(requestConfig.proxy).toBe(false);
        expect(requestConfig.url).toBe('https://epg.example/guide.xml');
    });

    it('supplies the validated lookup to an explicit HTTP agent factory', async () => {
        axiosMock.mockResolvedValueOnce({
            status: 200,
            headers: {},
            data: '#EXTM3U',
        });
        let pinnedLookup: LookupFunction | undefined;
        const factory: ValidatedRequestAgentFactory = {
            createHttpAgent: jest.fn((lookup) => {
                pinnedLookup = lookup;
                return new HttpAgent({ lookup });
            }),
        };

        await requestWithValidatedRedirects(
            'http://playlist.example/list.m3u',
            { agentFactory: factory, method: 'GET' },
            { resolveHostname: publicResolver }
        );

        const requestConfig = axiosMock.mock.calls[0][0];
        expect(factory.createHttpAgent).toHaveBeenCalledWith(pinnedLookup);
        expect(requestConfig.httpAgent).toBeInstanceOf(HttpAgent);
        expect(requestConfig).not.toHaveProperty('agentFactory');
    });

    it('uses a custom HTTPS agent factory when private networks are allowed', async () => {
        axiosMock.mockResolvedValueOnce({
            status: 200,
            headers: {},
            data: '#EXTM3U',
        });
        const factory: ValidatedRequestAgentFactory = {
            createHttpsAgent: jest.fn((lookup) => new HttpsAgent({ lookup })),
        };

        await requestWithValidatedRedirects(
            'https://192.168.1.10/list.m3u',
            { agentFactory: factory, method: 'GET' },
            { allowPrivateNetworks: true }
        );

        const requestConfig = axiosMock.mock.calls[0][0];
        expect(factory.createHttpsAgent).toHaveBeenCalledWith(
            undefined,
            new URL('https://192.168.1.10/list.m3u')
        );
        expect(requestConfig.httpsAgent).toBeInstanceOf(HttpsAgent);
        expect(requestConfig).not.toHaveProperty('agentFactory');
    });

    it('allows same-origin private redirects when private redirect access is disabled', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: '/media.ts' },
            })
            .mockResolvedValueOnce({
                status: 206,
                headers: {},
                data: 'ok',
            });

        const response = await requestWithValidatedRedirects(
            'http://192.168.1.10/start',
            { method: 'GET' },
            {
                allowPrivateNetworkRedirects: false,
                allowPrivateNetworks: true,
            }
        );

        expect(response.status).toBe(206);
        expect(axiosMock).toHaveBeenCalledTimes(2);
        expect(axiosMock.mock.calls[1][0].url).toBe(
            'http://192.168.1.10/media.ts'
        );
    });

    it('rejects cross-origin private redirects when private redirect access is disabled', async () => {
        axiosMock.mockResolvedValueOnce({
            status: 302,
            headers: { location: 'http://127.0.0.1/admin' },
        });

        await expect(
            requestWithValidatedRedirects(
                'http://192.168.1.10/start',
                { method: 'GET' },
                {
                    allowPrivateNetworkRedirects: false,
                    allowPrivateNetworks: true,
                }
            )
        ).rejects.toMatchObject({
            message: 'URL points to a private or local network address',
        });
        expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    it('reuses the initially validated addresses for same-origin redirects when private redirect access is disabled', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: '/media.ts' },
            })
            .mockResolvedValueOnce({
                status: 206,
                headers: {},
                data: 'ok',
            });
        const { factory, lookups } = createCapturingAgentFactory();
        const resolveHostname = jest.fn(async () => ['93.184.216.34']);

        const response = await requestWithValidatedRedirects(
            'https://portal.example/start',
            { agentFactory: factory, method: 'GET' },
            {
                allowPrivateNetworkRedirects: false,
                allowPrivateNetworks: true,
                pinAllowedPrivateNetworkHosts: true,
                resolveHostname,
            }
        );

        const resolvePinnedAddress = async (callIndex: number) => {
            return new Promise<string | LookupAddress[]>((resolve, reject) => {
                lookups[callIndex](
                    'portal.example',
                    { all: false, family: 0 } as LookupOptions,
                    (error, address) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve(address);
                    }
                );
            });
        };

        expect(response.status).toBe(206);
        expect(resolveHostname).toHaveBeenCalledTimes(1);
        expect(factory.createHttpsAgent).toHaveBeenCalledTimes(2);
        await expect(resolvePinnedAddress(0)).resolves.toBe('93.184.216.34');
        await expect(resolvePinnedAddress(1)).resolves.toBe('93.184.216.34');
    });

    it('revalidates and repins every redirect hop', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: 'https://cdn.example/guide.xml' },
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: '<tv />',
            });
        const { factory, lookups } = createCapturingAgentFactory();
        const resolveHostname = jest.fn(async (hostname: string) =>
            hostname === 'epg.example' ? ['93.184.216.34'] : ['142.250.191.110']
        );

        await requestWithValidatedRedirects(
            'https://epg.example/guide.xml',
            { agentFactory: factory, method: 'GET' },
            { resolveHostname }
        );

        const resolvePinnedAddress = async (callIndex: number) => {
            return new Promise<string | LookupAddress[]>((resolve, reject) => {
                lookups[callIndex](
                    'ignored.example',
                    { all: false, family: 0 } as LookupOptions,
                    (error, address) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve(address);
                    }
                );
            });
        };

        expect(resolveHostname).toHaveBeenNthCalledWith(1, 'epg.example');
        expect(resolveHostname).toHaveBeenNthCalledWith(2, 'cdn.example');
        expect(factory.createHttpsAgent).toHaveBeenCalledTimes(2);
        await expect(resolvePinnedAddress(0)).resolves.toBe('93.184.216.34');
        await expect(resolvePinnedAddress(1)).resolves.toBe('142.250.191.110');
    });

    it('runs narrow hooks in exact validated-hop order and collects redirects before preparing the next hop', async () => {
        const events: string[] = [];
        const resolveHostname = jest.fn(async (hostname: string) => {
            events.push(`validate:${hostname}`);
            return ['93.184.216.34'];
        });
        axiosMock
            .mockImplementationOnce(async (config) => {
                events.push(`axios:${config.url}:${config.headers['x-hop']}`);
                return {
                    status: 302,
                    headers: { location: '/next' },
                };
            })
            .mockImplementationOnce(async (config) => {
                events.push(`axios:${config.url}:${config.headers['x-hop']}`);
                return {
                    status: 200,
                    headers: {},
                    data: 'ok',
                };
            });

        await requestWithValidatedRedirects(
            'https://example.com/start',
            {
                method: 'GET',
                redirectHooks: {
                    prepareHeaders: async (hop) => {
                        events.push(`prepare:${hop.url}:${hop.method}`);
                        return {
                            ...hop.headers,
                            'x-hop': new URL(hop.url).pathname,
                        };
                    },
                    collectResponse: async (response) => {
                        events.push(
                            `collect:${response.url}:${response.status}`
                        );
                    },
                    beforeValidatedRedirect: async (redirect) => {
                        events.push(
                            `before:${redirect.fromUrl}->${redirect.toUrl}:${redirect.method}`
                        );
                    },
                },
            },
            { resolveHostname }
        );

        expect(events).toEqual([
            'validate:example.com',
            'prepare:https://example.com/start:GET',
            'axios:https://example.com/start:/start',
            'collect:https://example.com/start:302',
            'validate:example.com',
            'before:https://example.com/start->https://example.com/next:GET',
            'prepare:https://example.com/next:GET',
            'axios:https://example.com/next:/next',
            'collect:https://example.com/next:200',
        ]);
    });

    it('does not pass redirect hook internals to Axios', async () => {
        axiosMock.mockResolvedValueOnce({
            status: 200,
            headers: {},
            data: 'ok',
        });
        const redirectHooks = {
            prepareHeaders: jest.fn(async (hop) => hop.headers),
        };

        await requestWithValidatedRedirects(
            'https://example.com/start',
            { method: 'GET', redirectHooks },
            { resolveHostname: publicResolver }
        );

        expect(axiosMock.mock.calls[0][0]).not.toHaveProperty(
            'redirectHooks'
        );
    });

    it('prepares each hop from an isolated header snapshot', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: '/next' },
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: 'ok',
            });
        const observedBaseHeaders: string[][] = [];

        await requestWithValidatedRedirects(
            'https://example.com/start',
            {
                headers: { 'x-values': ['base'] },
                method: 'GET',
                redirectHooks: {
                    prepareHeaders: (hop) => {
                        const values = hop.headers['x-values'] as string[];
                        observedBaseHeaders.push([...values]);
                        values.push(new URL(hop.url).pathname);
                        return hop.headers;
                    },
                },
            },
            { resolveHostname: publicResolver }
        );

        expect(observedBaseHeaders).toEqual([['base'], ['base']]);
        expect(axiosMock.mock.calls[0][0].headers['x-values']).toEqual([
            'base',
            '/start',
        ]);
        expect(axiosMock.mock.calls[1][0].headers['x-values']).toEqual([
            'base',
            '/next',
        ]);
    });

    it('does not let response collection rewrite the validated redirect target', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: '/validated' },
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: 'ok',
            });

        await requestWithValidatedRedirects(
            'https://example.com/start',
            {
                method: 'GET',
                redirectHooks: {
                    collectResponse: (response) => {
                        response.headers.location = '/tampered';
                    },
                },
            },
            { resolveHostname: publicResolver }
        );

        expect(axiosMock.mock.calls[1][0].url).toBe(
            'https://example.com/validated'
        );
    });

    it('collects a rejected HTTP response before propagating the Axios failure', async () => {
        const rejected = {
            response: {
                status: 401,
                headers: { 'set-cookie': ['session=synthetic; Path=/'] },
            },
        };
        const collectResponse = jest.fn();
        axiosMock.mockRejectedValueOnce(rejected);

        await expect(
            requestWithValidatedRedirects(
                'https://example.com/start',
                {
                    method: 'GET',
                    redirectHooks: { collectResponse },
                },
                { resolveHostname: publicResolver }
            )
        ).rejects.toBe(rejected);

        expect(collectResponse).toHaveBeenCalledWith({
            headers: {
                'set-cookie': ['session=synthetic; Path=/'],
            },
            method: 'GET',
            status: 401,
            url: 'https://example.com/start',
        });
    });

    it('allows a validated cross-origin redirect to pause before target preparation or contact', async () => {
        class RedirectPause extends Error {}

        const pause = new RedirectPause('approval-required');
        const resolveHostname = jest.fn(async (hostname: string) =>
            hostname === 'example.com'
                ? ['93.184.216.34']
                : ['142.250.191.110']
        );
        const prepareHeaders = jest.fn(async (hop) => hop.headers);
        const collectResponse = jest.fn(async () => undefined);
        const beforeValidatedRedirect = jest.fn(async () => {
            throw pause;
        });
        axiosMock.mockResolvedValueOnce({
            status: 302,
            headers: { location: 'https://target.example/landing' },
        });

        await expect(
            requestWithValidatedRedirects(
                'https://example.com/start',
                {
                    method: 'GET',
                    redirectHooks: {
                        beforeValidatedRedirect,
                        collectResponse,
                        prepareHeaders,
                    },
                },
                { resolveHostname }
            )
        ).rejects.toBe(pause);

        expect(resolveHostname).toHaveBeenNthCalledWith(1, 'example.com');
        expect(resolveHostname).toHaveBeenNthCalledWith(
            2,
            'target.example'
        );
        expect(collectResponse).toHaveBeenCalledTimes(1);
        expect(beforeValidatedRedirect).toHaveBeenCalledWith({
            crossOrigin: true,
            fromUrl: 'https://example.com/start',
            method: 'GET',
            status: 302,
            toUrl: 'https://target.example/landing',
        });
        expect(prepareHeaders).toHaveBeenCalledTimes(1);
        expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        {
            location: '/same',
            name: 'same target',
            startUrl: 'https://example.com/same',
        },
        {
            location: '#two',
            name: 'fragment-only target',
            startUrl: 'https://example.com/same#one',
        },
    ])(
        'rejects a repeated $name before another contact',
        async ({ location, startUrl }) => {
            const beforeValidatedRedirect = jest.fn();
            const prepareHeaders = jest.fn(async (hop) => hop.headers);
            axiosMock.mockResolvedValueOnce({
                status: 302,
                headers: { location },
            });

            await expect(
                requestWithValidatedRedirects(
                    startUrl,
                    {
                        method: 'GET',
                        redirectHooks: {
                            beforeValidatedRedirect,
                            prepareHeaders,
                        },
                    },
                    { resolveHostname: publicResolver }
                )
            ).rejects.toMatchObject({
                message: expect.stringMatching(/redirect loop/i),
                status: 502,
            });

            expect(beforeValidatedRedirect).not.toHaveBeenCalled();
            expect(prepareHeaders).toHaveBeenCalledTimes(1);
            expect(axiosMock).toHaveBeenCalledTimes(1);
        }
    );

    it('allows a same-target POST redirect when its effective method rewrites to GET', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: '/submit#result' },
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: 'ok',
            });

        await requestWithValidatedRedirects(
            'https://example.com/submit',
            { data: { value: 1 }, method: 'POST' },
            { resolveHostname: publicResolver }
        );

        expect(axiosMock).toHaveBeenCalledTimes(2);
        expect(axiosMock.mock.calls[1][0]).toMatchObject({
            data: undefined,
            method: 'GET',
            url: 'https://example.com/submit#result',
        });
    });

    it('removes sensitive headers when a redirect changes origin', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: 'https://cdn.example.net/playlist.m3u' },
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: '#EXTM3U',
            });

        await requestWithValidatedRedirects(
            'https://example.com/playlist.m3u',
            {
                headers: {
                    Authorization: 'Bearer secret',
                    Cookie: 'session=secret',
                    Accept: 'text/plain',
                },
                method: 'GET',
            },
            { resolveHostname: publicResolver }
        );

        const redirectedConfig = axiosMock.mock.calls[1][0];
        expect(redirectedConfig.headers).toMatchObject({
            Accept: 'text/plain',
        });
        expect(redirectedConfig.headers).not.toHaveProperty('Authorization');
        expect(redirectedConfig.headers).not.toHaveProperty('Cookie');
    });

    it('does not forward axios params to a cross-origin redirect', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: 'https://cdn.example.net/playlist.m3u' },
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: '#EXTM3U',
            });

        await requestWithValidatedRedirects(
            'https://example.com/playlist.m3u',
            {
                method: 'GET',
                params: { token: 'secret' },
            },
            { resolveHostname: publicResolver }
        );

        expect(axiosMock.mock.calls[1][0].params).toBeUndefined();
    });

    it('does not forward axios basic auth to a cross-origin redirect', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 302,
                headers: { location: 'https://cdn.example.net/playlist.m3u' },
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: '#EXTM3U',
            });

        await requestWithValidatedRedirects(
            'https://example.com/playlist.m3u',
            {
                auth: { password: 'secret', username: 'provider' },
                method: 'GET',
            },
            { resolveHostname: publicResolver }
        );

        expect(axiosMock.mock.calls[1][0].auth).toBeUndefined();
    });

    it('rejects a cross-origin redirect that would replay a request body', async () => {
        axiosMock.mockResolvedValueOnce({
            status: 307,
            headers: { location: 'https://other.example/submit' },
        });

        await expect(
            requestWithValidatedRedirects(
                'https://example.com/submit',
                { data: { secret: true }, method: 'POST' },
                { resolveHostname: publicResolver }
            )
        ).rejects.toThrow(/request bodies/i);
        expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    it('rejects redirects without a location header', async () => {
        axiosMock.mockResolvedValueOnce({
            status: 302,
            headers: {},
        });

        await expect(
            requestWithValidatedRedirects(
                'https://example.com/start',
                { method: 'GET' },
                { resolveHostname: publicResolver }
            )
        ).rejects.toMatchObject({
            message: expect.stringMatching(/location/i),
            status: 502,
        });
    });

    it('stops after the configured redirect limit', async () => {
        axiosMock.mockResolvedValue({
            status: 302,
            headers: { location: '/again' },
        });

        await expect(
            requestWithValidatedRedirects(
                'https://example.com/start',
                { method: 'GET' },
                { resolveHostname: publicResolver },
                1
            )
        ).rejects.toMatchObject({
            message: expect.stringMatching(/too many redirects/i),
            status: 502,
        });
        expect(axiosMock).toHaveBeenCalledTimes(2);
    });

    it('converts a 303 redirect to GET and removes the request body', async () => {
        axiosMock
            .mockResolvedValueOnce({
                status: 303,
                headers: { location: '/result' },
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: 'ok',
            });

        await requestWithValidatedRedirects(
            'https://example.com/submit',
            { data: { value: 1 }, method: 'POST' },
            { resolveHostname: publicResolver }
        );

        expect(axiosMock.mock.calls[1][0]).toMatchObject({
            data: undefined,
            method: 'GET',
            url: 'https://example.com/result',
        });
    });

    it.each([301, 302])(
        'converts a POST redirected with %i to GET and removes the request body',
        async (status) => {
            axiosMock
                .mockResolvedValueOnce({
                    status,
                    headers: { location: '/result' },
                })
                .mockResolvedValueOnce({
                    status: 200,
                    headers: {},
                    data: 'ok',
                });

            await requestWithValidatedRedirects(
                'https://example.com/submit',
                { data: { value: 1 }, method: 'POST' },
                { resolveHostname: publicResolver }
            );

            expect(axiosMock.mock.calls[1][0]).toMatchObject({
                data: undefined,
                method: 'GET',
                url: 'https://example.com/result',
            });
        }
    );
});
