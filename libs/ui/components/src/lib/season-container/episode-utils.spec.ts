import {
    XTREAM_CLIENT_USER_AGENT,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    buildXtreamEpisodeDownloadRequest,
    getEpisodeDownloadId,
    hashString,
    isStalkerEpisode,
} from './episode-download.util';
import {
    formatEpisodePositionText,
    parseDuration,
} from './episode-progress.util';

const episode = (overrides: Record<string, unknown>): XtreamSerieEpisode =>
    ({ id: '10', episode_num: 1, title: 'Ep', ...overrides }) as never;

describe('episode-download.util', () => {
    it('detects stalker-mapped episodes', () => {
        expect(isStalkerEpisode(episode({ custom_sid: 'vod-series' }))).toBe(
            true
        );
        expect(
            isStalkerEpisode(episode({ custom_sid: 'regular-series' }))
        ).toBe(true);
        expect(isStalkerEpisode(episode({}))).toBe(false);
    });

    it('resolves download ids per episode source', () => {
        expect(getEpisodeDownloadId(episode({}))).toBe(10);
        expect(
            getEpisodeDownloadId(
                episode({
                    custom_sid: 'regular-series',
                    originalCmd: '/media/file_777.mpg',
                })
            )
        ).toBe(777);
        expect(
            getEpisodeDownloadId(
                episode({ custom_sid: 'vod-series', originalId: '42' })
            )
        ).toBe(42);
        expect(
            getEpisodeDownloadId(
                episode({ custom_sid: 'vod-series', originalId: 'abc' })
            )
        ).toBe(hashString('abc'));
    });

    it('builds an Xtream episode download request', () => {
        const request = buildXtreamEpisodeDownloadRequest({
            episode: episode({
                id: '55',
                episode_num: 3,
                season: 2,
                container_extension: 'mkv',
                title: 'The One',
            }),
            context: {
                serverUrl: 'http://host/',
                username: 'u',
                password: 'p',
            },
            playlistId: 'pl-1',
            seriesId: 900,
            seriesTitle: 'Show',
            fallbackSeasonKey: '1',
        });

        expect(request).toEqual({
            playlistId: 'pl-1',
            xtreamId: 55,
            contentType: 'episode',
            title: 'Show - S02E03 - The One',
            url: 'http://host/series/u/p/55.mkv',
            posterUrl: undefined,
            seriesXtreamId: 900,
            seasonNumber: 2,
            episodeNumber: 3,
            headers: {
                userAgent: XTREAM_CLIENT_USER_AGENT,
                referer: undefined,
                origin: undefined,
            },
        });
    });

    it('forwards playlist request headers for the first episode transfer', () => {
        const request = buildXtreamEpisodeDownloadRequest({
            episode: episode({ id: '55' }),
            context: {
                serverUrl: 'http://host',
                username: 'u',
                password: 'p',
                userAgent: 'Provider Player/1.0',
                referrer: 'https://provider.test/player',
                origin: 'https://provider.test',
            },
            playlistId: 'pl-1',
            seriesId: 900,
            seriesTitle: 'Show',
            fallbackSeasonKey: '1',
        });

        expect(request.headers).toEqual({
            userAgent: 'Provider Player/1.0',
            referer: 'https://provider.test/player',
            origin: 'https://provider.test',
        });
    });

    it('adds the loaded series and episode metadata when provided', () => {
        const request = buildXtreamEpisodeDownloadRequest({
            episode: episode({
                id: '55',
                episode_num: 3,
                season: 2,
                title: 'The One',
                info: {
                    plot: 'Episode plot',
                    movie_image: 'https://images.test/stills/one.jpg',
                },
            }),
            context: { serverUrl: 'http://host' },
            playlistId: 'pl-1',
            seriesId: 900,
            seriesTitle: 'Show',
            fallbackSeasonKey: '1',
            metadataContext: {
                language: 'de',
                title: 'Show',
                plot: 'Series plot',
                genres: ['Drama'],
                posterUrl: 'poster.jpg',
                providerCategoryId: '7',
                cast: [{ name: 'Actor' }],
            },
        });

        expect(request.metadataSnapshot).toEqual(
            expect.objectContaining({
                language: 'de',
                mediaKind: 'series',
                title: 'Show',
                plot: 'Series plot',
                genres: ['Drama'],
                providerCategoryId: '7',
                cast: [{ name: 'Actor' }],
                episode: {
                    seasonNumber: 2,
                    episodeNumber: 3,
                    title: 'The One',
                    plot: 'Episode plot',
                    stillUrl: 'https://images.test/stills/one.jpg',
                },
            })
        );
    });

    it('creates a valid sparse snapshot without provider enrichment', () => {
        const request = buildXtreamEpisodeDownloadRequest({
            episode: episode({ season: 1, info: [] }),
            context: {},
            playlistId: 'pl-1',
            seriesId: 900,
            seriesTitle: 'Show',
            fallbackSeasonKey: undefined,
            metadataContext: { language: 'en', title: 'Show' },
        });

        expect(request.metadataSnapshot).toEqual(
            expect.objectContaining({
                language: 'en',
                mediaKind: 'series',
                title: 'Show',
                episode: {
                    seasonNumber: 1,
                    episodeNumber: 1,
                    title: 'Ep',
                },
            })
        );
    });
});

describe('episode-progress.util', () => {
    it('parses duration strings', () => {
        expect(parseDuration('01:00:30')).toBe(3630);
        expect(parseDuration('45:12')).toBe(2712);
        expect(parseDuration(120)).toBe(120);
        expect(parseDuration(undefined)).toBe(0);
    });

    it('formats remaining time when duration is known', () => {
        expect(
            formatEpisodePositionText({
                contentXtreamId: 1,
                contentType: 'episode',
                positionSeconds: 60,
                durationSeconds: 360,
            })
        ).toBe('05:00 left');
    });

    it('returns null for watched or missing positions', () => {
        expect(formatEpisodePositionText(undefined)).toBeNull();
        expect(
            formatEpisodePositionText({
                contentXtreamId: 1,
                contentType: 'episode',
                positionSeconds: 350,
                durationSeconds: 360,
            })
        ).toBeNull();
    });
});
