import { type ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import {
    createVideoJsOptions,
    createWebPlayerChannel,
    resolveWebPlayerIsLive,
    resolveWebPlayerMediaTitle,
    resolveWebPlayerPlayback,
} from './web-player-playback-state';

describe('web player playback state', () => {
    it('preserves an existing resolved playback payload', () => {
        const playback: ResolvedPortalPlayback = {
            streamUrl: 'https://provider.example/movie/7.ts',
            title: 'Movie Seven',
            startTime: 42,
            headers: { Authorization: 'Bearer secret' },
        };

        expect(
            resolveWebPlayerPlayback({
                playback,
                streamUrl: 'https://fallback.example/stream',
                title: 'Fallback',
                startTime: 0,
            })
        ).toBe(playback);
    });

    it('constructs fallback playback and uses the URL for a missing title', () => {
        expect(
            resolveWebPlayerPlayback({
                playback: null,
                streamUrl: 'https://example.com/live/1.ts',
                title: '',
                startTime: 19,
            })
        ).toEqual({
            streamUrl: 'https://example.com/live/1.ts',
            title: 'https://example.com/live/1.ts',
            startTime: 19,
        });
    });

    it('uses explicit live metadata before inferring VOD from content info', () => {
        const playback: ResolvedPortalPlayback = {
            streamUrl: 'https://example.com/movie.ts',
            title: 'Movie',
            isLive: true,
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 7,
                contentType: 'vod',
            },
        };

        expect(resolveWebPlayerIsLive(playback)).toBe(true);
        expect(resolveWebPlayerIsLive({ ...playback, isLive: undefined })).toBe(
            false
        );
    });

    it('resolves an explicit media title, playback title, and raw URL fallback', () => {
        const playback: ResolvedPortalPlayback = {
            streamUrl: 'https://example.com/movie.ts',
            title: 'Movie',
        };

        expect(
            resolveWebPlayerMediaTitle(
                { primary: 'Series', secondary: 'S01E02' },
                playback
            )
        ).toEqual({ primary: 'Series', secondary: 'S01E02' });
        expect(resolveWebPlayerMediaTitle(null, playback)).toEqual({
            primary: 'Movie',
            secondary: null,
        });
        expect(
            resolveWebPlayerMediaTitle(null, {
                ...playback,
                title: playback.streamUrl,
            })
        ).toBeNull();
    });

    it('prefers explicit HTTP metadata when constructing a channel', () => {
        expect(
            createWebPlayerChannel({
                streamUrl: 'https://example.com/live/channel.m3u8',
                title: 'Header Locked Channel',
                thumbnail: 'https://example.com/logo.png',
                userAgent: 'ProviderAgent/1.0',
                referer: 'https://provider.example/ref',
                origin: 'https://provider.example',
                headers: {
                    'User-Agent': 'IgnoredAgent/1.0',
                    Referer: 'https://ignored.example/ref',
                    Origin: 'https://ignored.example',
                },
                drm: {
                    licenseType: 'clearkey',
                    supported: true,
                    clearKeys: { '0011': '2233' },
                },
            })
        ).toEqual(
            expect.objectContaining({
                id: 'https://example.com/live/channel.m3u8',
                url: 'https://example.com/live/channel.m3u8',
                name: 'Header Locked Channel',
                tvg: expect.objectContaining({
                    name: 'Header Locked Channel',
                    logo: 'https://example.com/logo.png',
                }),
                http: {
                    'user-agent': 'ProviderAgent/1.0',
                    referrer: 'https://provider.example/ref',
                    origin: 'https://provider.example',
                },
                radio: 'false',
                drm: {
                    licenseType: 'clearkey',
                    supported: true,
                    clearKeys: { '0011': '2233' },
                },
            })
        );
    });

    it('falls back to case-insensitive HTTP headers', () => {
        expect(
            createWebPlayerChannel({
                streamUrl: 'https://example.com/live/channel.m3u8',
                title: '',
                headers: {
                    'uSeR-aGeNt': 'HeaderAgent/1.0',
                    rEfErEr: 'https://headers.example/ref',
                    ORIGIN: 'https://headers.example',
                },
            }).http
        ).toEqual({
            'user-agent': 'HeaderAgent/1.0',
            referrer: 'https://headers.example/ref',
            origin: 'https://headers.example',
        });
    });

    it.each([
        ['https://example.com/live/index.m3u8', 'application/x-mpegURL'],
        [
            'https://example.com/play?extension=m3u8&token=signed',
            'application/x-mpegURL',
        ],
        ['https://example.com/live/channel.ts', 'video/mp2t'],
        ['https://example.com/live.php?stream=123', 'video/mp2t'],
        ['https://example.com/archive/movie.mkv', 'video/matroska'],
        [
            'https://example.com/play?container=mkv&token=signed',
            'video/matroska',
        ],
        ['https://example.com/archive/movie.mp4', 'video/mp4'],
    ])('selects the existing MIME type for %s', (streamUrl, type) => {
        expect(
            createVideoJsOptions({
                streamUrl,
                isLive: false,
                reloadToken: 3,
            })
        ).toEqual({
            isLive: false,
            reloadToken: 3,
            sources: [{ src: streamUrl, type }],
        });
    });
});
