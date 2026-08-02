import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { createStalkerSeriesDownloadAdapter } from './stalker-series-download.adapter';

const EPISODE_POSTER_URL = 'https://images.example.test/stills/the-call.jpg';
const SERIES_POSTER_URL =
    'https://images.example.test/posters/signal-house.jpg';

const PLAYLIST = {
    _id: 'stalker-1',
    title: 'Living Room Portal',
    portalUrl: 'https://stalker.example.test/stalker_portal/c/',
    macAddress: '00:1A:79:12:34:56',
    userAgent: 'Stalker Client/1.0',
    referrer: 'https://stalker.example.test/c/',
    origin: 'https://stalker.example.test',
} as const;

const ITEM = {
    id: '50001',
    cmd: '/media/file_50001.mpg',
    category_id: '18',
    info: {
        name: 'Signal House',
        o_name: 'La casa de la señal',
        description: 'Parent series plot',
        movie_image: SERIES_POSTER_URL,
        actors: 'Sienna Wave',
        director: 'Cora Bell',
        releasedate: '2025-03-01',
        genre: 'Drama, Mystery',
        rating_imdb: '8.4',
        rating_kinopoisk: '8.0',
        tmdb_id: 88001,
        tmdb_status: 'returning-series',
    },
} as const;

function episode(
    overrides: Partial<XtreamSerieEpisode> & {
        originalCmd?: string;
        originalId?: string;
    } = {}
): XtreamSerieEpisode {
    return {
        id: '61001',
        episode_num: 3,
        title: 'The Call',
        container_extension: 'mpg',
        info: {
            plot: 'Episode-specific plot',
            movie_image: EPISODE_POSTER_URL,
        },
        custom_sid: 'regular-series',
        added: '',
        season: 2,
        direct_source: '',
        originalCmd: '/media/file_777.mpg',
        ...overrides,
    } as XtreamSerieEpisode;
}

function options(
    resolveUrl = jest
        .fn()
        .mockResolvedValue('https://cdn.example.test/episode.mpg')
) {
    return {
        playlist: PLAYLIST,
        item: ITEM,
        language: 'en',
        seriesId: 50001,
        seriesMode: 'regular-series' as const,
        resolveUrl,
    };
}

describe('createStalkerSeriesDownloadAdapter', () => {
    it.each([
        ['regular-series', 'stalker-regular-series'],
        ['embedded-vod', 'stalker-embedded-vod'],
        ['lazy-vod', 'stalker-lazy-vod'],
    ] as const)(
        'scopes %s coordinates independently',
        (seriesMode, expectedScope) => {
            const adapter = createStalkerSeriesDownloadAdapter({
                ...options(),
                seriesMode,
            });
            const candidate = adapter.createCandidate(episode(), '2');

            expect(
                (
                    candidate?.identity as
                        { episodeIdentityScope?: string } | undefined
                )?.episodeIdentityScope
            ).toBe(expectedScope);
        }
    );

    it('keeps regular-series candidate identity distinct when playback ownership collides', async () => {
        const resolveUrl = jest
            .fn()
            .mockResolvedValue('https://cdn.example.test/episode.mpg');
        const adapter = createStalkerSeriesDownloadAdapter(options(resolveUrl));
        const first = adapter.createCandidate(episode({ id: '61001' }), '2');
        const second = adapter.createCandidate(episode({ id: '61002' }), '2');

        expect(first?.identity.xtreamId).toBe(61001);
        expect(second?.identity.xtreamId).toBe(61002);
        expect(first?.identity).not.toEqual(second?.identity);
        await expect(first?.prepare()).resolves.toEqual(
            expect.objectContaining({ xtreamId: 61001 })
        );
        await expect(second?.prepare()).resolves.toEqual(
            expect.objectContaining({ xtreamId: 61002 })
        );
        expect(resolveUrl).toHaveBeenNthCalledWith(1, '/media/file_777.mpg', 3);
        expect(resolveUrl).toHaveBeenNthCalledWith(2, '/media/file_777.mpg', 3);
    });

    it('keeps VOD-series candidate identity distinct when originalId ownership collides', async () => {
        const resolveUrl = jest
            .fn()
            .mockResolvedValue('https://cdn.example.test/episode.mpg');
        const adapter = createStalkerSeriesDownloadAdapter(options(resolveUrl));
        const first = adapter.createCandidate(
            episode({
                id: '62001',
                custom_sid: 'vod-series',
                originalCmd: undefined,
                originalId: '777',
            }),
            '2'
        );
        const second = adapter.createCandidate(
            episode({
                id: '62002',
                custom_sid: 'vod-series',
                originalCmd: undefined,
                originalId: '777',
            }),
            '2'
        );

        expect(first?.identity.xtreamId).toBe(62001);
        expect(second?.identity.xtreamId).toBe(62002);
        expect(first?.identity).not.toEqual(second?.identity);
        await expect(first?.prepare()).resolves.toEqual(
            expect.objectContaining({ xtreamId: 62001 })
        );
        await expect(second?.prepare()).resolves.toEqual(
            expect.objectContaining({ xtreamId: 62002 })
        );
        expect(resolveUrl).toHaveBeenNthCalledWith(1, '/media/file_777.mpg', 3);
        expect(resolveUrl).toHaveBeenNthCalledWith(2, '/media/file_777.mpg', 3);
    });

    it('prepares the complete Stalker episode request and versioned snapshot', async () => {
        const resolveUrl = jest
            .fn()
            .mockResolvedValue('https://cdn.example.test/episode.mpg');
        const candidate = createStalkerSeriesDownloadAdapter(
            options(resolveUrl)
        ).createCandidate(episode(), '1');

        expect(candidate?.identity).toEqual({
            playlistId: 'stalker-1',
            contentType: 'episode',
            xtreamId: 61001,
            seriesXtreamId: 50001,
            seasonNumber: 2,
            episodeNumber: 3,
            episodeIdentityScope: 'stalker-regular-series',
        });
        if (!candidate) {
            throw new Error('expected a valid Stalker episode candidate');
        }

        const request = await candidate.prepare();
        const { metadataSnapshot, ...requestWithoutSnapshot } = request;
        expect(requestWithoutSnapshot).toEqual({
            playlistId: 'stalker-1',
            contentType: 'episode',
            xtreamId: 61001,
            seriesXtreamId: 50001,
            seasonNumber: 2,
            episodeNumber: 3,
            episodeIdentityScope: 'stalker-regular-series',
            title: 'Signal House - S02E03 - The Call',
            url: 'https://cdn.example.test/episode.mpg',
            posterUrl: EPISODE_POSTER_URL,
            headers: {
                userAgent: 'Stalker Client/1.0',
                referer: 'https://stalker.example.test/c/',
                origin: 'https://stalker.example.test',
            },
            playlistName: 'Living Room Portal',
            playlistType: 'stalker',
            portalUrl: 'https://stalker.example.test/stalker_portal/c/',
            macAddress: '00:1A:79:12:34:56',
        });
        expect(metadataSnapshot).toEqual({
            version: 1,
            language: 'en',
            mediaKind: 'series',
            title: 'Signal House',
            originalTitle: 'La casa de la señal',
            plot: 'Parent series plot',
            releaseDate: '2025-03-01',
            year: 2025,
            genres: ['Drama', 'Mystery'],
            rating: 8.4,
            status: 'returning-series',
            posterUrl: SERIES_POSTER_URL,
            tmdbId: 88001,
            providerCategoryId: '18',
            cast: [{ name: 'Sienna Wave' }],
            creators: [{ name: 'Cora Bell' }],
            episode: {
                seasonNumber: 2,
                episodeNumber: 3,
                title: 'The Call',
                plot: 'Episode-specific plot',
                stillUrl: EPISODE_POSTER_URL,
            },
            enrichedAt: expect.any(String),
        });
        expect(resolveUrl).toHaveBeenCalledWith('/media/file_777.mpg', 3);
    });

    it.each([
        ['regular series', 'regular-series', '/media/file_301.mpg', undefined],
        [
            'embedded VOD series',
            'regular-series',
            '/media/file_401.mpg',
            undefined,
        ],
        ['lazy VOD series', 'vod-series', undefined, '501'],
    ] as const)(
        'preserves %s playback ownership solely for URL resolution',
        async (_label, customSid, originalCmd, originalId) => {
            const resolveUrl = jest
                .fn()
                .mockResolvedValue('https://cdn.example.test/episode.mpg');
            const candidate = createStalkerSeriesDownloadAdapter(
                options(resolveUrl)
            ).createCandidate(
                episode({
                    id: '63001',
                    custom_sid: customSid,
                    originalCmd,
                    originalId,
                    episode_num: 7,
                }),
                '4'
            );

            await expect(candidate?.prepare()).resolves.toEqual(
                expect.objectContaining({ xtreamId: 63001 })
            );
            expect(resolveUrl).toHaveBeenCalledWith(
                customSid === 'vod-series'
                    ? '/media/file_501.mpg'
                    : originalCmd,
                7
            );
        }
    );

    it('preserves specials season zero and the existing fallback rules', async () => {
        const adapter = createStalkerSeriesDownloadAdapter(options());
        const specials = adapter.createCandidate(
            episode({ season: 0, episode_num: 0 }),
            '4'
        );

        expect(specials?.identity).toEqual(
            expect.objectContaining({ seasonNumber: 0, episodeNumber: 1 })
        );
        expect(
            adapter.createCandidate(episode({ season: Number.NaN }), '0')
                ?.identity
        ).toEqual(
            expect.objectContaining({ seasonNumber: 0, episodeNumber: 3 })
        );
        expect(
            adapter.createCandidate(
                episode({ season: Number.NaN, episode_num: Number.NaN }),
                undefined
            )?.identity
        ).toEqual(
            expect.objectContaining({ seasonNumber: 1, episodeNumber: 1 })
        );
        await expect(specials?.prepare()).resolves.toEqual(
            expect.objectContaining({
                title: 'Signal House - S00E01 - The Call',
            })
        );
    });

    it('uses the Stalker Portal title fallback', async () => {
        const candidate = createStalkerSeriesDownloadAdapter({
            ...options(),
            playlist: { ...PLAYLIST, title: '' },
        }).createCandidate(episode(), '2');

        await expect(candidate?.prepare()).resolves.toEqual(
            expect.objectContaining({ playlistName: 'Stalker Portal' })
        );
    });

    it('rejects preparation when URL resolution returns an empty URL', async () => {
        const candidate = createStalkerSeriesDownloadAdapter(
            options(jest.fn().mockResolvedValue('   '))
        ).createCandidate(episode(), '2');

        await expect(candidate?.prepare()).rejects.toThrow(Error);
    });

    it('propagates a rejected URL resolver promise', async () => {
        const providerFailure = new Error('provider failure');
        const candidate = createStalkerSeriesDownloadAdapter(
            options(jest.fn().mockRejectedValue(providerFailure))
        ).createCandidate(episode(), '2');

        await expect(candidate?.prepare()).rejects.toBe(providerFailure);
    });

    it.each([
        ['missing playlist', { playlist: null }, {}, '2'],
        [
            'missing playlist id',
            { playlist: { ...PLAYLIST, _id: '' } },
            {},
            '2',
        ],
        [
            'missing portal URL',
            { playlist: { ...PLAYLIST, portalUrl: undefined } },
            {},
            '2',
        ],
        [
            'missing MAC address',
            { playlist: { ...PLAYLIST, macAddress: '' } },
            {},
            '2',
        ],
        ['missing item', { item: null }, {}, '2'],
        ['missing language', { language: '   ' }, {}, '2'],
        [
            'unsafe episode id',
            {},
            { id: String(Number.MAX_SAFE_INTEGER + 1) },
            '2',
        ],
        ['non-numeric episode id', {}, { id: 'episode-1' }, '2'],
        ['non-positive episode id', {}, { id: '0' }, '2'],
        [
            'unsafe series id',
            { seriesId: Number.MAX_SAFE_INTEGER + 1 },
            {},
            '2',
        ],
        ['non-positive series id', { seriesId: 0 }, {}, '2'],
        ['unsafe season', {}, { season: 1.5 }, '2'],
        ['non-positive season', {}, { season: -1 }, '2'],
        ['unsafe episode number', {}, { episode_num: 1.5 }, '2'],
        ['non-positive episode number', {}, { episode_num: -1 }, '2'],
        ['non-positive fallback season', {}, { season: Number.NaN }, '-2'],
        [
            'unsafe fallback season',
            {},
            { season: Number.NaN },
            String(Number.MAX_SAFE_INTEGER + 1),
        ],
    ] as const)(
        'returns null for %s',
        (_label, optionOverrides, episodeOverrides, fallbackSeasonKey) => {
            const adapter = createStalkerSeriesDownloadAdapter({
                ...options(),
                ...optionOverrides,
            } as never);

            expect(
                adapter.createCandidate(
                    episode(episodeOverrides),
                    fallbackSeasonKey
                )
            ).toBeNull();
        }
    );
});
