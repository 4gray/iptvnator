import axios, { type AxiosRequestConfig } from 'axios';
import type { LookupFunction } from 'node:net';
import { XTREAM_CLIENT_USER_AGENT } from '@iptvnator/shared/interfaces';
import { matchVlcGuidePlaylist } from './vlc-guide-playlist';
import { validateRemoteUrl } from './url-safety';

jest.mock('axios', () => ({
    __esModule: true,
    default: jest.fn(),
}));
jest.mock('./url-safety', () => ({
    ...jest.requireActual('./url-safety'),
    validateRemoteUrl: jest.fn(async (url: string) => ({
        url: new URL(url),
        addresses: ['192.0.2.10'],
    })),
}));

const request = axios as unknown as jest.Mock<unknown, [AxiosRequestConfig]>;
const playlist = 'https://portal.example.test/synthetic.m3u';
const child = 'synthetic-child.ts';
const m3u = { 'content-type': 'audio/mpegurl' };

function response(status: number, headers: Record<string, string>, data = '') {
    return async (config: AxiosRequestConfig) => ({
        config,
        status,
        headers,
        data,
    });
}

describe('VLC playlist verification redirects', () => {
    beforeEach(() => {
        request.mockReset();
        jest.mocked(validateRemoteUrl).mockClear();
    });

    it('pins the playlist GET to the exact address that answered HEAD', async () => {
        const connected = '192.0.2.20';
        jest.mocked(validateRemoteUrl).mockResolvedValueOnce({
            url: new URL(playlist),
            addresses: ['192.0.2.10', connected],
        });
        request
            .mockImplementationOnce(async (config) => ({
                ...(await response(200, m3u)(config)),
                request: { socket: { remoteAddress: connected } },
            }))
            .mockImplementationOnce(async (config) => {
                const lookup: LookupFunction = config.httpsAgent.options.lookup;
                const address = await new Promise((resolve, reject) =>
                    lookup('portal.example.test', {}, (error, value) =>
                        error ? reject(error) : resolve(value)
                    )
                );
                expect(address).toBe(connected);
                return response(200, m3u, child)(config);
            });
        await expect(
            matchVlcGuidePlaylist(playlist, { mergedHeaders: {} })(
                new URL(child, playlist).href
            )
        ).resolves.toBe(true);
        expect(validateRemoteUrl).toHaveBeenCalledTimes(1);
    });

    it.each([
        'https://edge.example.test/synthetic.m3u',
        'http://portal.example.test/synthetic.m3u',
    ])(
        'does not replay playback credentials on an unsafe redirect to %s',
        async (target) => {
            const trusted = new URL('/trusted.m3u', playlist).href;
            const headers = {
                'X-Api-Key': 'synthetic-key',
                Referer: 'https://portal.example.test/synthetic?token=example',
                'User-Agent': 'Synthetic Override',
            };
            request
                .mockImplementationOnce(response(302, { location: trusted }))
                .mockImplementationOnce(response(302, { location: target }))
                .mockImplementationOnce(response(200, m3u))
                .mockImplementationOnce(response(200, m3u, child));
            const match = matchVlcGuidePlaylist(playlist, {
                mergedHeaders: headers,
                effectiveReferer: headers.Referer,
                effectiveUserAgent: headers['User-Agent'],
            });
            await expect(match(new URL(child, target).href)).resolves.toBe(
                true
            );
            expect(
                request.mock.calls.map(([config]) => config?.method)
            ).toEqual(['HEAD', 'HEAD', 'HEAD', 'GET']);
            expect(request.mock.calls[1][0]).toMatchObject({
                url: trusted,
                headers,
            });
            const safe = { 'User-Agent': XTREAM_CLIENT_USER_AGENT };
            expect(
                request.mock.calls.slice(2).map(([config]) => config?.headers)
            ).toEqual([safe, safe]);
            expect(validateRemoteUrl).toHaveBeenLastCalledWith(
                target,
                expect.objectContaining({ allowPrivateNetworks: false })
            );
        }
    );

    it('does not fetch media when the redirected HEAD identifies it', async () => {
        request
            .mockImplementationOnce(
                response(302, { location: '/synthetic-live.m3u' })
            )
            .mockImplementationOnce(
                response(200, { 'content-type': 'video/mp2t' })
            );
        await expect(
            matchVlcGuidePlaylist(playlist, { mergedHeaders: {} })(
                new URL(child, playlist).href
            )
        ).resolves.toBe(false);
        expect(request.mock.calls.map(([config]) => config?.method)).toEqual([
            'HEAD',
            'HEAD',
        ]);
    });

    it.each([200, 405])(
        'refuses a playlist GET redirect after a HEAD response of %s',
        async (status) => {
            request
                .mockImplementationOnce(response(status, m3u))
                .mockImplementationOnce(async (config) => {
                    expect(config.validateStatus?.(302)).toBe(false);
                    throw new Error('Synthetic GET redirect');
                });
            await expect(
                matchVlcGuidePlaylist(playlist, { mergedHeaders: {} })(
                    new URL(child, playlist).href
                )
            ).resolves.toBe(false);
            expect(
                request.mock.calls.map(([config]) => [
                    config?.method,
                    config?.url,
                ])
            ).toEqual([
                ['HEAD', playlist],
                ['GET', playlist],
            ]);
        }
    );
});
