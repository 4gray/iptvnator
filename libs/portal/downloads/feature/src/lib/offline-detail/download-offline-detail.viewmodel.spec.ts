import type { DownloadItem } from '@iptvnator/services';
import type {
    DownloadEpisodeMetadata,
    DownloadMetadataSnapshot,
} from '@iptvnator/shared/interfaces';
import {
    buildDownloadOfflineDetail,
    DOWNLOAD_OFFLINE_COORDINATE_FALLBACK,
    type DownloadOfflineDetail,
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

describe('buildDownloadOfflineDetail', () => {
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
                seasonNumber: DOWNLOAD_OFFLINE_COORDINATE_FALLBACK,
                episodes: [
                    {
                        item: selected,
                        seasonNumber: DOWNLOAD_OFFLINE_COORDINATE_FALLBACK,
                        episodeNumber: DOWNLOAD_OFFLINE_COORDINATE_FALLBACK,
                    },
                ],
            },
        ]);
    });

    it('uses zero as the stable fallback for sparse or invalid coordinates without dropping files', () => {
        const sparse = download(23, {
            seasonNumber: undefined,
            episodeNumber: undefined,
        });
        const invalid = download(24, {
            seasonNumber: -2,
            episodeNumber: 1.5,
        });
        const valid = download(25, {
            seasonNumber: 1,
            episodeNumber: 3,
        });
        const downloads = deepFreeze([valid, sparse, invalid]);

        const series = expectSeries(build(23, downloads));

        expect(DOWNLOAD_OFFLINE_COORDINATE_FALLBACK).toBe(0);
        expect(
            series.seasons.map(({ seasonNumber, episodes }) => ({
                seasonNumber,
                episodes: episodes.map(({ item, episodeNumber }) => ({
                    id: item.id,
                    episodeNumber,
                })),
            }))
        ).toEqual([
            {
                seasonNumber: 0,
                episodes: [
                    { id: 23, episodeNumber: 0 },
                    { id: 24, episodeNumber: 0 },
                ],
            },
            {
                seasonNumber: 1,
                episodes: [{ id: 25, episodeNumber: 3 }],
            },
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
                episodeNumber: 1,
                episodeMetadata: firstEpisode,
            },
            {
                item: second,
                seasonNumber: 1,
                episodeNumber: 2,
                episodeMetadata: secondEpisode,
            },
        ]);
    });
});
