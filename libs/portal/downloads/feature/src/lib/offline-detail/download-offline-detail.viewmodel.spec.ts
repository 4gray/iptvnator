import type { DownloadItem } from '@iptvnator/services';
import type {
    DownloadEpisodeMetadata,
    DownloadMetadataSnapshot,
} from '@iptvnator/shared/interfaces';
import {
    buildDownloadOfflineDetail,
    type DeepReadonly,
    type DownloadOfflineDetail,
    type DownloadOfflineEpisode,
    type DownloadOfflineMovieDetail,
} from './download-offline-detail.viewmodel';

const SERIES_ID = 77;
const CREATED_AT = '2026-01-01T00:00:00.000Z';

function deepFreeze<T>(value: T): T {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
        if (
            child !== null &&
            typeof child === 'object' &&
            !Object.isFrozen(child)
        ) {
            deepFreeze(child);
        }
    }
    return value;
}

function download(
    id: number,
    overrides: Partial<DownloadItem> = {}
): DownloadItem {
    return {
        id,
        playlistId: 'playlist-a',
        xtreamId: 1_000 + id,
        contentType: 'episode',
        seriesXtreamId: SERIES_ID,
        seasonNumber: 1,
        episodeNumber: 1,
        title: `Download ${id}`,
        url: `https://media.example.test/${id}`,
        filePath: `/downloads/${id}.mp4`,
        fileAvailability: 'available',
        status: 'completed',
        createdAt: CREATED_AT,
        ...overrides,
    };
}

function snapshot(
    mediaKind: DownloadMetadataSnapshot['mediaKind'],
    title: string,
    overrides: Partial<DownloadMetadataSnapshot> = {}
): DownloadMetadataSnapshot {
    return {
        version: 1,
        language: 'en',
        mediaKind,
        title,
        ...overrides,
    };
}

function build(
    downloadId: number,
    downloads: readonly DownloadItem[]
): DownloadOfflineDetail | undefined {
    return buildDownloadOfflineDetail({ downloadId, downloads });
}

function expectSeries(
    detail: DownloadOfflineDetail | undefined
): Extract<DownloadOfflineDetail, { kind: 'series' }> {
    expect(detail?.kind).toBe('series');
    if (detail?.kind !== 'series') {
        throw new Error('Expected an offline series detail');
    }
    return detail;
}

function assertReadonlyViewModelTypes(
    episode: DownloadOfflineEpisode,
    movie: DownloadOfflineMovieDetail
): void {
    const item: DeepReadonly<DownloadItem> = episode.item;
    void item;

    // @ts-expect-error View-model source items are recursively readonly.
    episode.item.title = 'Mutated title';
    if (episode.item.metadataSnapshot?.genres) {
        // @ts-expect-error Nested snapshot arrays are recursively readonly.
        episode.item.metadataSnapshot.genres.push('Mutation');
    }
    if (episode.episodeMetadata) {
        // @ts-expect-error Per-episode metadata is recursively readonly.
        episode.episodeMetadata.title = 'Mutated episode';
    }
    if (movie.snapshot) {
        // @ts-expect-error Detail snapshots are recursively readonly.
        movie.snapshot.title = 'Mutated movie';
    }
}

describe('buildDownloadOfflineDetail', () => {
    it('exposes source data through recursive readonly view-model types', () => {
        expect(assertReadonlyViewModelTypes).toBeDefined();
    });

    it('resolves an available movie by its exact positive integer download id', () => {
        const movieSnapshot = snapshot('movie', 'Stored movie');
        const selected = download(7, {
            contentType: 'vod',
            seriesXtreamId: undefined,
            metadataSnapshot: movieSnapshot,
        });
        const downloads = deepFreeze([
            download(6, {
                contentType: 'vod',
                seriesXtreamId: undefined,
            }),
            selected,
            download(8, {
                contentType: 'vod',
                seriesXtreamId: undefined,
            }),
        ]);

        const detail = build(7, downloads);

        expect(detail).toEqual({
            kind: 'movie',
            item: selected,
            snapshot: movieSnapshot,
        });
        expect(detail?.kind === 'movie' && detail.item).toBe(selected);
    });

    it.each([
        Number.NaN,
        Number.NEGATIVE_INFINITY,
        -1,
        0,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        Number.POSITIVE_INFINITY,
    ])('rejects the invalid download id %p', (downloadId) => {
        const downloads = deepFreeze([
            download(downloadId, {
                contentType: 'vod',
                seriesXtreamId: undefined,
            }),
        ]);

        expect(build(downloadId, downloads)).toBeUndefined();
    });

    it.each([
        ['non-completed', { status: 'paused' as const }],
        ['missing path', { filePath: undefined }],
        ['empty path', { filePath: '   ' }],
        ['explicitly missing file', { fileAvailability: 'missing' as const }],
    ])('does not resolve a movie with %s', (_description, overrides) => {
        const unavailable = download(9, {
            contentType: 'vod',
            seriesXtreamId: undefined,
            ...overrides,
        });

        expect(build(9, deepFreeze([unavailable]))).toBeUndefined();
    });

    it('keeps legacy completed rows available when fileAvailability is absent', () => {
        const legacy = download(9, {
            contentType: 'vod',
            seriesXtreamId: undefined,
            fileAvailability: undefined,
        });

        expect(build(9, deepFreeze([legacy]))).toEqual({
            kind: 'movie',
            item: legacy,
        });
    });

    it('uses only a movie snapshot for a movie detail', () => {
        const wrongKind = snapshot('series', 'Not movie metadata');
        const movie = download(9, {
            contentType: 'vod',
            seriesXtreamId: undefined,
            metadataSnapshot: wrongKind,
        });

        expect(build(9, deepFreeze([movie]))).toEqual({
            kind: 'movie',
            item: movie,
        });
    });

    it('groups only locally available members with the exact series identity', () => {
        const representative = download(10, {
            seasonNumber: 1,
            episodeNumber: 5,
        });
        const seasonOneEpisodeTwo = download(11, {
            seasonNumber: 1,
            episodeNumber: 2,
        });
        const missing = download(12, {
            seasonNumber: 1,
            episodeNumber: 3,
            fileAvailability: 'missing',
        });
        const seasonTwoEpisodeOne = download(13, {
            seasonNumber: 2,
            episodeNumber: 1,
        });
        const downloads = deepFreeze([
            representative,
            seasonOneEpisodeTwo,
            missing,
            seasonTwoEpisodeOne,
            download(14, {
                playlistId: 'playlist-b',
                seasonNumber: 1,
                episodeNumber: 1,
            }),
            download(15, {
                seriesXtreamId: SERIES_ID + 1,
                seasonNumber: 1,
                episodeNumber: 1,
            }),
            download(16, {
                contentType: 'vod',
                seasonNumber: 1,
                episodeNumber: 1,
            }),
            download(17, {
                status: 'failed',
                seasonNumber: 1,
                episodeNumber: 4,
            }),
            download(18, {
                filePath: '',
                seasonNumber: 2,
                episodeNumber: 2,
            }),
        ]);
        const before = JSON.stringify(downloads);

        const series = expectSeries(build(10, downloads));

        expect(series.representative).toBe(representative);
        expect(series.seasons.map(({ seasonNumber }) => seasonNumber)).toEqual([
            1, 2,
        ]);
        expect(
            series.seasons.map(({ episodes }) =>
                episodes.map(({ item }) => item.id)
            )
        ).toEqual([[11, 10], [13]]);
        expect(JSON.stringify(downloads)).toBe(before);
        expect(downloads.map(({ id }) => id)).toEqual([
            10, 11, 12, 13, 14, 15, 16, 17, 18,
        ]);
    });

    it('allows any available group member to represent the same series', () => {
        const first = download(10, {
            seasonNumber: 1,
            episodeNumber: 5,
        });
        const second = download(11, {
            seasonNumber: 1,
            episodeNumber: 2,
        });
        const downloads = deepFreeze([first, second]);

        const series = expectSeries(build(11, downloads));

        expect(series.representative).toBe(second);
        expect(series.seasons[0].episodes.map(({ item }) => item.id)).toEqual([
            11, 10,
        ]);
    });

    it('does not resolve an unavailable representative through available group members', () => {
        const unavailableRepresentative = download(10, {
            fileAvailability: 'missing',
        });
        const availableMember = download(11);
        const downloads = deepFreeze([
            unavailableRepresentative,
            availableMember,
        ]);

        expect(build(10, downloads)).toBeUndefined();
        expect(build(99, downloads)).toBeUndefined();
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects an episode with the invalid explicit series id %p',
        (seriesXtreamId) => {
            const invalid = download(20, { seriesXtreamId });

            expect(build(20, deepFreeze([invalid]))).toBeUndefined();
        }
    );

    it('isolates a legacy episode without a series id as a one-episode series', () => {
        const selected = download(21, {
            seriesXtreamId: undefined,
            seasonNumber: undefined,
            episodeNumber: undefined,
        });
        const unrelatedLegacyEpisode = download(22, {
            seriesXtreamId: undefined,
            seasonNumber: 4,
            episodeNumber: 8,
        });
        const downloads = deepFreeze([selected, unrelatedLegacyEpisode]);

        const series = expectSeries(build(21, downloads));

        expect(series.representative).toBe(selected);
        expect(series.seasons).toEqual([
            {
                seasonNumber: null,
                seasonNumberState: 'unknown',
                episodes: [
                    {
                        item: selected,
                        seasonNumber: null,
                        seasonNumberState: 'unknown',
                        episodeNumber: null,
                        episodeNumberState: 'unknown',
                    },
                ],
            },
        ]);
    });

    it('distinguishes valid S0E0 specials from unknown coordinates', () => {
        const special = download(23, {
            seasonNumber: 0,
            episodeNumber: 0,
        });
        const sparse = download(24, {
            seasonNumber: undefined,
            episodeNumber: undefined,
        });
        const invalid = download(25, {
            seasonNumber: -2,
            episodeNumber: 1.5,
        });
        const downloads = deepFreeze([invalid, sparse, special]);

        const series = expectSeries(build(23, downloads));

        expect(
            series.seasons.map(
                ({ seasonNumber, seasonNumberState, episodes }) => ({
                    seasonNumber,
                    seasonNumberState,
                    episodes: episodes.map(
                        ({
                            item,
                            seasonNumber: episodeSeasonNumber,
                            seasonNumberState: episodeSeasonNumberState,
                            episodeNumber,
                            episodeNumberState,
                        }) => ({
                            id: item.id,
                            seasonNumber: episodeSeasonNumber,
                            seasonNumberState: episodeSeasonNumberState,
                            episodeNumber,
                            episodeNumberState,
                        })
                    ),
                })
            )
        ).toEqual([
            {
                seasonNumber: 0,
                seasonNumberState: 'known',
                episodes: [
                    {
                        id: 23,
                        seasonNumber: 0,
                        seasonNumberState: 'known',
                        episodeNumber: 0,
                        episodeNumberState: 'known',
                    },
                ],
            },
            {
                seasonNumber: null,
                seasonNumberState: 'unknown',
                episodes: [
                    {
                        id: 24,
                        seasonNumber: null,
                        seasonNumberState: 'unknown',
                        episodeNumber: null,
                        episodeNumberState: 'unknown',
                    },
                    {
                        id: 25,
                        seasonNumber: null,
                        seasonNumberState: 'unknown',
                        episodeNumber: null,
                        episodeNumberState: 'unknown',
                    },
                ],
            },
        ]);
    });

    it('keeps multiple unknown episodes distinct and orders them by createdAt then id', () => {
        const downloads = deepFreeze([
            download(63, {
                seasonNumber: undefined,
                episodeNumber: undefined,
                createdAt: '2026-01-03T00:00:00.000Z',
            }),
            download(62, {
                seasonNumber: Number.NaN,
                episodeNumber: Number.POSITIVE_INFINITY,
                createdAt: '2026-01-02T00:00:00.000Z',
            }),
            download(61, {
                seasonNumber: -1,
                episodeNumber: Number.MAX_SAFE_INTEGER + 1,
                createdAt: '2026-01-02T00:00:00.000Z',
            }),
        ]);

        const series = expectSeries(build(63, downloads));

        expect(series.seasons).toHaveLength(1);
        expect(series.seasons[0]).toEqual(
            expect.objectContaining({
                seasonNumber: null,
                seasonNumberState: 'unknown',
            })
        );
        expect(
            series.seasons[0].episodes.map(({ item, episodeNumber }) => ({
                id: item.id,
                episodeNumber,
            }))
        ).toEqual([
            { id: 61, episodeNumber: null },
            { id: 62, episodeNumber: null },
            { id: 63, episodeNumber: null },
        ]);
    });

    it('orders invalid or missing createdAt after valid timestamps and then by id', () => {
        const downloads = deepFreeze([
            download(73, {
                seasonNumber: 1,
                episodeNumber: 4,
                createdAt: undefined,
            }),
            download(72, {
                seasonNumber: 1,
                episodeNumber: 4,
                createdAt: 'invalid',
            }),
            download(71, {
                seasonNumber: 1,
                episodeNumber: 4,
                createdAt: '2026-01-02T00:00:00.000Z',
            }),
        ]);

        const series = expectSeries(build(73, downloads));

        expect(series.seasons[0].episodes.map(({ item }) => item.id)).toEqual([
            71, 72, 73,
        ]);
    });

    it('sorts unknown episodes after known episodes within a known season', () => {
        const downloads = deepFreeze([
            download(28, {
                seasonNumber: 1,
                episodeNumber: undefined,
            }),
            download(27, {
                seasonNumber: 1,
                episodeNumber: 5,
            }),
            download(26, {
                seasonNumber: 1,
                episodeNumber: 2,
            }),
        ]);

        const series = expectSeries(build(28, downloads));

        expect(
            series.seasons[0].episodes.map(
                ({ item, episodeNumber, episodeNumberState }) => ({
                    id: item.id,
                    episodeNumber,
                    episodeNumberState,
                })
            )
        ).toEqual([
            { id: 26, episodeNumber: 2, episodeNumberState: 'known' },
            { id: 27, episodeNumber: 5, episodeNumberState: 'known' },
            { id: 28, episodeNumber: null, episodeNumberState: 'unknown' },
        ]);
    });

    it('does not collapse known and unknown season groups', () => {
        const downloads = deepFreeze([
            download(30, {
                seasonNumber: undefined,
                episodeNumber: 2,
            }),
            download(29, {
                seasonNumber: 0,
                episodeNumber: 3,
            }),
        ]);

        const series = expectSeries(build(30, downloads));

        expect(
            series.seasons.map(({ seasonNumber, seasonNumberState }) => ({
                seasonNumber,
                seasonNumberState,
            }))
        ).toEqual([
            { seasonNumber: 0, seasonNumberState: 'known' },
            { seasonNumber: null, seasonNumberState: 'unknown' },
        ]);
    });

    it('sorts seasons and episodes numerically, then duplicate episodes by createdAt and id', () => {
        const downloads = deepFreeze([
            download(35, {
                seasonNumber: 2,
                episodeNumber: 1,
            }),
            download(34, {
                seasonNumber: 1,
                episodeNumber: 4,
                createdAt: '2026-01-03T00:00:00.000Z',
            }),
            download(33, {
                seasonNumber: 1,
                episodeNumber: 4,
                createdAt: '2026-01-02T00:00:00.000Z',
            }),
            download(32, {
                seasonNumber: 1,
                episodeNumber: 4,
                createdAt: '2026-01-02T00:00:00.000Z',
            }),
            download(31, {
                seasonNumber: 1,
                episodeNumber: 2,
            }),
        ]);

        const series = expectSeries(build(35, downloads));

        expect(
            series.seasons.map(({ seasonNumber, episodes }) => ({
                seasonNumber,
                ids: episodes.map(({ item }) => item.id),
            }))
        ).toEqual([
            { seasonNumber: 1, ids: [31, 32, 33, 34] },
            { seasonNumber: 2, ids: [35] },
        ]);
    });

    it('selects snapshots by the newest per-row enrichedAt or timestamp fallback', () => {
        const staleEnrichment = snapshot('series', 'Stale enrichment', {
            enrichedAt: '2026-02-01T00:00:00.000Z',
        });
        const newerRow = snapshot('series', 'Newer row');
        const wrongKind = snapshot('movie', 'Wrong kind', {
            enrichedAt: '2027-01-01T00:00:00.000Z',
        });
        const downloads = deepFreeze([
            download(40, {
                metadataSnapshot: staleEnrichment,
                updatedAt: '2026-12-01T00:00:00.000Z',
            }),
            download(41, {
                metadataSnapshot: newerRow,
                updatedAt: '2026-03-01T00:00:00.000Z',
            }),
            download(42, {
                metadataSnapshot: wrongKind,
                updatedAt: '2027-01-01T00:00:00.000Z',
            }),
        ]);

        const series = expectSeries(build(40, downloads));

        expect(series.snapshot).toBe(newerRow);
    });

    it('falls through invalid snapshot and row timestamps before breaking ties by id', () => {
        const first = snapshot('series', 'First', {
            enrichedAt: 'invalid',
        });
        const updatedFallback = snapshot('series', 'Updated fallback', {
            enrichedAt: 'invalid',
        });
        const createdFallback = snapshot('series', 'Created fallback', {
            enrichedAt: 'invalid',
        });
        const greaterId = snapshot('series', 'Greater id', {
            enrichedAt: 'invalid',
        });
        const downloads = deepFreeze([
            download(47, {
                metadataSnapshot: first,
                updatedAt: '2026-06-01T00:00:00.000Z',
            }),
            download(48, {
                metadataSnapshot: updatedFallback,
                updatedAt: '2026-06-05T00:00:00.000Z',
            }),
            download(49, {
                metadataSnapshot: createdFallback,
                updatedAt: 'invalid',
                createdAt: '2026-06-06T00:00:00.000Z',
            }),
            download(50, {
                metadataSnapshot: greaterId,
                updatedAt: 'invalid',
                createdAt: '2026-06-06T00:00:00.000Z',
            }),
        ]);

        const forward = expectSeries(build(47, downloads));
        const reversed = expectSeries(
            build(47, deepFreeze([...downloads].reverse()))
        );

        expect(forward.snapshot).toBe(greaterId);
        expect(reversed.snapshot).toBe(greaterId);
    });

    it('selects snapshots with entirely invalid timestamps deterministically by id', () => {
        const lowerId = snapshot('series', 'Lower id', {
            enrichedAt: 'invalid',
        });
        const middleId = snapshot('series', 'Middle id', {
            enrichedAt: 'invalid',
        });
        const greaterId = snapshot('series', 'Greater id', {
            enrichedAt: 'invalid',
        });
        const downloads = deepFreeze([
            download(53, {
                metadataSnapshot: lowerId,
                updatedAt: 'invalid',
                createdAt: 'invalid',
            }),
            download(54, {
                metadataSnapshot: middleId,
                updatedAt: undefined,
                createdAt: undefined,
            }),
            download(55, {
                metadataSnapshot: greaterId,
                updatedAt: 'invalid',
                createdAt: undefined,
            }),
        ]);

        const forward = expectSeries(build(53, downloads));
        const reversed = expectSeries(
            build(53, deepFreeze([...downloads].reverse()))
        );

        expect(forward.snapshot).toBe(greaterId);
        expect(reversed.snapshot).toBe(greaterId);
    });

    it('keeps each episode tied to its own snapshot episode metadata', () => {
        const firstEpisode: DownloadEpisodeMetadata = {
            title: 'Pilot',
            plot: 'The first episode.',
            stillUrl: 'https://media.example.test/pilot.jpg',
            seasonNumber: 1,
            episodeNumber: 1,
        };
        const secondEpisode: DownloadEpisodeMetadata = {
            title: 'Second episode',
            seasonNumber: 1,
            episodeNumber: 2,
        };
        const firstSnapshot = snapshot('series', 'Series title', {
            enrichedAt: '2026-01-01T00:00:00.000Z',
            episode: firstEpisode,
        });
        const secondSnapshot = snapshot('series', 'Series title', {
            enrichedAt: '2026-02-01T00:00:00.000Z',
            episode: secondEpisode,
        });
        const first = download(51, {
            episodeNumber: 1,
            metadataSnapshot: firstSnapshot,
        });
        const second = download(52, {
            episodeNumber: 2,
            metadataSnapshot: secondSnapshot,
        });
        const downloads = deepFreeze([first, second]);

        const series = expectSeries(build(51, downloads));

        expect(series.snapshot).toBe(secondSnapshot);
        expect(series.seasons[0].episodes).toEqual([
            {
                item: first,
                seasonNumber: 1,
                seasonNumberState: 'known',
                episodeNumber: 1,
                episodeNumberState: 'known',
                episodeMetadata: firstEpisode,
            },
            {
                item: second,
                seasonNumber: 1,
                seasonNumberState: 'known',
                episodeNumber: 2,
                episodeNumberState: 'known',
                episodeMetadata: secondEpisode,
            },
        ]);
    });
});
