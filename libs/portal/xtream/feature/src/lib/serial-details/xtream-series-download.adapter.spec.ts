import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { createXtreamSeriesDownloadAdapter } from './xtream-series-download.adapter';

const POSTER_URL = 'https://images.test/stills/the-one.jpg';

const OPTIONS = {
    playlistId: 'playlist-1',
    seriesId: 900,
    title: 'Signal House',
    serverUrl: 'http://host/',
    username: 'user',
    password: 'pass',
    metadataContext: {
        language: 'en',
        title: 'Signal House',
        plot: 'Series plot',
    },
} as const;

function episode(
    overrides: Partial<XtreamSerieEpisode> = {}
): XtreamSerieEpisode {
    return {
        id: '55',
        episode_num: 3,
        title: 'The One',
        container_extension: 'mkv',
        info: {
            plot: 'Episode plot',
            movie_image: POSTER_URL,
        },
        custom_sid: '',
        added: '',
        season: 2,
        direct_source: '',
        ...overrides,
    };
}

describe('createXtreamSeriesDownloadAdapter', () => {
    it('creates a canonical candidate and prepares the complete Xtream request', async () => {
        const adapter = createXtreamSeriesDownloadAdapter(OPTIONS);

        const candidate = adapter.createCandidate(episode(), '1');

        expect(candidate?.identity).toEqual({
            playlistId: 'playlist-1',
            contentType: 'episode',
            xtreamId: 55,
            seriesXtreamId: 900,
            seasonNumber: 2,
            episodeNumber: 3,
        });
        if (!candidate) {
            throw new Error('expected a valid Xtream episode candidate');
        }

        const request = await candidate.prepare();
        const { metadataSnapshot, ...requestWithoutSnapshot } = request;
        expect(requestWithoutSnapshot).toEqual({
            playlistId: 'playlist-1',
            xtreamId: 55,
            contentType: 'episode',
            title: 'Signal House - S02E03 - The One',
            url: 'http://host/series/user/pass/55.mkv',
            posterUrl: POSTER_URL,
            seriesXtreamId: 900,
            seasonNumber: 2,
            episodeNumber: 3,
        });
        expect(metadataSnapshot).toEqual({
            version: 1,
            language: 'en',
            mediaKind: 'series',
            title: 'Signal House',
            plot: 'Series plot',
            episode: {
                seasonNumber: 2,
                episodeNumber: 3,
                title: 'The One',
                plot: 'Episode plot',
                stillUrl: POSTER_URL,
            },
            enrichedAt: expect.any(String),
        });
    });

    it('preserves the existing season and episode fallback rules', async () => {
        const adapter = createXtreamSeriesDownloadAdapter(OPTIONS);
        const fromSeasonKey = adapter.createCandidate(
            episode({ season: 0, episode_num: 0 }),
            '4'
        );
        const defaults = adapter.createCandidate(
            episode({ season: 0, episode_num: Number.NaN }),
            undefined
        );

        expect(fromSeasonKey?.identity).toEqual(
            expect.objectContaining({ seasonNumber: 4, episodeNumber: 1 })
        );
        expect(defaults?.identity).toEqual(
            expect.objectContaining({ seasonNumber: 1, episodeNumber: 1 })
        );
        await expect(fromSeasonKey?.prepare()).resolves.toEqual(
            expect.objectContaining({
                title: 'Signal House - S04E01 - The One',
            })
        );
    });

    it('preserves raw Xtream path concatenation and the mp4 extension fallback', async () => {
        const adapter = createXtreamSeriesDownloadAdapter({
            ...OPTIONS,
            serverUrl: 'http://host/base//',
            username: 'u@ser',
            password: 'p/a',
        });
        const candidate = adapter.createCandidate(
            episode({ container_extension: '' }),
            undefined
        );

        await expect(candidate?.prepare()).resolves.toEqual(
            expect.objectContaining({
                url: 'http://host/base//series/u@ser/p/a/55.mp4',
            })
        );
    });

    it.each([
        ['missing server URL', { serverUrl: undefined }, {}, undefined],
        ['empty server URL', { serverUrl: '   ' }, {}, undefined],
        ['missing username', { username: undefined }, {}, undefined],
        ['empty username', { username: '' }, {}, undefined],
        ['missing password', { password: undefined }, {}, undefined],
        ['empty password', { password: '   ' }, {}, undefined],
        ['missing playlist id', { playlistId: undefined }, {}, undefined],
        ['empty playlist id', { playlistId: '   ' }, {}, undefined],
        ['unsafe episode id', {}, { id: 'not-an-id' }, undefined],
        ['non-positive episode id', {}, { id: '0' }, undefined],
        [
            'unsafe series id',
            { seriesId: Number.MAX_SAFE_INTEGER + 1 },
            {},
            undefined,
        ],
        ['non-positive series id', { seriesId: 0 }, {}, undefined],
        ['unsafe season', {}, { season: 1.5 }, undefined],
        ['unsafe episode number', {}, { episode_num: -1 }, undefined],
        ['unsafe fallback season', {}, { season: 0 }, '-2'],
    ] as const)(
        'returns null for %s',
        (_label, optionOverrides, episodeOverrides, fallbackSeasonKey) => {
            const adapter = createXtreamSeriesDownloadAdapter({
                ...OPTIONS,
                ...optionOverrides,
            });

            expect(
                adapter.createCandidate(
                    episode(episodeOverrides),
                    fallbackSeasonKey
                )
            ).toBeNull();
        }
    );
});
