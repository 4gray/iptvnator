import type { DownloadItem } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    buildDownloadManagerViewModel,
    normalizeDownloadFilter,
    type DownloadEpisodeCardViewModel,
    type DownloadLibraryEntity,
    type DownloadManagerViewModel,
    type DownloadMovieCardViewModel,
    type DownloadSeriesCardViewModel,
} from './download-manager.viewmodel';

type PlaylistSummary = Pick<Playlist, '_id' | 'title'>;
type ExpectedDownloadLibraryEntity =
    | DownloadMovieCardViewModel
    | DownloadEpisodeCardViewModel
    | DownloadSeriesCardViewModel;

const PLAYLISTS: readonly PlaylistSummary[] = [
    { _id: 'playlist-a', title: 'Alpha Source' },
    { _id: 'playlist-b', title: 'Beta Source' },
];

function download(
    id: number,
    overrides: Partial<DownloadItem> = {}
): DownloadItem {
    return {
        id,
        playlistId: 'playlist-a',
        xtreamId: id * 10,
        contentType: 'vod',
        title: `Download ${id}`,
        url: `https://example.test/${id}`,
        status: 'completed',
        createdAt: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z`,
        ...overrides,
    };
}

function build(
    downloads: readonly DownloadItem[],
    options: {
        playlists?: readonly PlaylistSummary[];
        scopePlaylistId?: string;
        filter?: string;
        searchTerm?: string;
    } = {}
): DownloadManagerViewModel {
    return buildDownloadManagerViewModel({
        downloads,
        playlists: options.playlists ?? PLAYLISTS,
        scopePlaylistId: options.scopePlaylistId,
        filter: options.filter ?? 'all',
        searchTerm: options.searchTerm,
    });
}

function rowIds(
    rows:
        | DownloadManagerViewModel['active']
        | DownloadManagerViewModel['attention']
): number[] {
    return rows.map(({ item }) => item.id);
}

function libraryItemIds(entities: readonly DownloadLibraryEntity[]): number[] {
    const typedEntities: readonly ExpectedDownloadLibraryEntity[] = entities;
    return typedEntities.flatMap((entity) =>
        entity.kind === 'series'
            ? entity.members.map(({ id }) => id)
            : [entity.item.id]
    );
}

describe('normalizeDownloadFilter', () => {
    it.each(['all', 'movie', 'series', 'in-progress', 'recording'] as const)(
        'keeps the known %s filter',
        (filter) => {
            expect(normalizeDownloadFilter(filter)).toBe(filter);
        }
    );

    it.each([null, undefined, '', 'unknown', 'MOVIE'])(
        'normalizes %p to all',
        (filter) => {
            expect(normalizeDownloadFilter(filter)).toBe('all');
        }
    );
});

describe('buildDownloadManagerViewModel', () => {
    it('supports global and playlist-scoped views with resolved source labels', () => {
        const downloads = [
            download(1, { status: 'queued' }),
            download(2, {
                playlistId: 'playlist-b',
                status: 'failed',
            }),
            download(3, {
                playlistId: 'missing-playlist',
                status: 'completed',
            }),
        ];

        const global = build(downloads);
        const scoped = build(downloads, { scopePlaylistId: 'playlist-a' });

        expect(global.scopedItems.map(({ id }) => id)).toEqual([1, 2, 3]);
        expect(global.active[0].sourceName).toBe('Alpha Source');
        expect(global.attention[0].sourceName).toBe('Beta Source');
        expect(global.library[0].sourceName).toBe('');
        expect(scoped.scopedItems.map(({ id }) => id)).toEqual([1]);
        expect(rowIds(scoped.active)).toEqual([1]);
        expect(scoped.attention).toEqual([]);
        expect(scoped.library).toEqual([]);
    });

    it('applies all four display filters across active, attention, and library partitions', () => {
        const downloads = [
            download(1, { status: 'queued' }),
            download(2, {
                contentType: 'episode',
                status: 'failed',
                seasonNumber: 1,
                episodeNumber: 2,
            }),
            download(3),
            download(4, {
                contentType: 'episode',
                seriesXtreamId: 44,
                seasonNumber: 1,
                episodeNumber: 1,
            }),
        ];

        const all = build(downloads);
        const movies = build(downloads, { filter: 'movie' });
        const series = build(downloads, { filter: 'series' });
        const inProgress = build(downloads, { filter: 'in-progress' });

        expect(rowIds(all.active)).toEqual([1]);
        expect(rowIds(all.attention)).toEqual([2]);
        expect(all.library.map(({ kind }) => kind)).toEqual([
            'series',
            'movie',
        ]);

        expect(rowIds(movies.active)).toEqual([1]);
        expect(movies.attention).toEqual([]);
        expect(movies.library.map(({ kind }) => kind)).toEqual(['movie']);

        expect(series.active).toEqual([]);
        expect(rowIds(series.attention)).toEqual([2]);
        expect(series.library.map(({ kind }) => kind)).toEqual(['series']);

        expect(rowIds(inProgress.active)).toEqual([1]);
        expect(inProgress.attention).toEqual([]);
        expect(inProgress.library).toEqual([]);
    });

    it('hides every download row under the recording filter but keeps counts', () => {
        const downloads = [
            download(1, { status: 'queued' }),
            download(2, { status: 'failed' }),
            download(3, { status: 'completed' }),
        ];
        const model = build(downloads, { filter: 'recording' });
        expect(model.active).toEqual([]);
        expect(model.attention).toEqual([]);
        expect(model.library).toEqual([]);
        // Chip counts stay derived from the unfiltered scoped set.
        expect(model.counts.all).toBe(3);
    });

    it('keeps queued, downloading, and paused rows in the in-progress filter only', () => {
        const result = build(
            [
                download(1, { status: 'queued' }),
                download(2, { status: 'downloading' }),
                download(3, { status: 'paused' }),
                download(4, { status: 'failed' }),
                download(5, { status: 'completed' }),
            ],
            { filter: 'in-progress' }
        );

        expect(rowIds(result.active)).toEqual([1, 2, 3]);
        expect(result.attention).toEqual([]);
        expect(result.library).toEqual([]);
    });

    it('keeps scoped counts stable when search hides every displayed item', () => {
        const downloads = [
            download(1, {
                status: 'queued',
                bytesDownloaded: 1,
            }),
            download(2, {
                contentType: 'episode',
                status: 'downloading',
                bytesDownloaded: 2,
            }),
            download(3, {
                status: 'paused',
                bytesDownloaded: 3,
            }),
            download(4, {
                contentType: 'episode',
                status: 'failed',
                bytesDownloaded: 4,
            }),
            download(5, {
                status: 'canceled',
                bytesDownloaded: 5,
            }),
            download(6, { bytesDownloaded: 6 }),
            download(7, {
                contentType: 'episode',
                seriesXtreamId: 70,
                bytesDownloaded: 7,
            }),
            download(8, {
                contentType: 'episode',
                seriesXtreamId: 70,
                bytesDownloaded: 8,
            }),
            download(9, {
                contentType: 'episode',
                bytesDownloaded: 9,
            }),
            download(10, {
                playlistId: 'playlist-b',
                status: 'queued',
                bytesDownloaded: 100,
            }),
        ];

        const visible = build(downloads, { scopePlaylistId: 'playlist-a' });
        const hidden = build(downloads, {
            scopePlaylistId: 'playlist-a',
            searchTerm: 'no result can match this',
        });

        expect(visible.counts).toEqual({
            all: 8,
            movie: 4,
            series: 4,
            inProgress: 3,
        });
        expect(hidden.counts).toEqual(visible.counts);
        expect(hidden.scopedItems).toHaveLength(9);
        expect(hidden.active).toEqual([]);
        expect(hidden.attention).toEqual([]);
        expect(hidden.library).toEqual([]);
        expect(hidden.activeCount).toBe(2);
        expect(hidden.trackedBytes).toBe(45);
        expect(hidden.hasClearable).toBe(true);
    });

    it('keeps counts stable under every display filter', () => {
        const downloads = [
            download(1, { status: 'queued' }),
            download(2, {
                contentType: 'episode',
                status: 'paused',
            }),
            download(3, { status: 'failed' }),
            download(4),
            download(5, {
                contentType: 'episode',
                seriesXtreamId: 50,
            }),
            download(6, {
                contentType: 'episode',
                seriesXtreamId: 50,
            }),
        ];
        const expected = {
            all: 5,
            movie: 3,
            series: 2,
            inProgress: 2,
        };

        for (const filter of [
            'all',
            'movie',
            'series',
            'in-progress',
        ] as const) {
            expect(build(downloads, { filter }).counts).toEqual(expected);
        }
    });

    it('searches stored title, derived series title, source, episode label, and error message', () => {
        const downloads = [
            download(1, {
                title: 'Solar Feature',
                status: 'queued',
            }),
            download(2, {
                contentType: 'episode',
                title: 'Archive Show - S01E02 - The Pilot',
                seasonNumber: 1,
                episodeNumber: 2,
                status: 'paused',
            }),
            download(3, {
                playlistId: 'playlist-b',
                title: 'Unrelated',
                status: 'failed',
            }),
            download(4, {
                contentType: 'episode',
                title: 'A legacy chapter',
                seasonNumber: 7,
                episodeNumber: 8,
            }),
            download(5, {
                title: 'Another unrelated item',
                status: 'canceled',
                errorMessage: 'Checksum mismatch',
            }),
        ];

        expect(
            libraryItemIds(
                build(downloads, {
                    searchTerm: '  A LEGACY CHAPTER ',
                }).library
            )
        ).toEqual([4]);
        expect(
            rowIds(
                build(downloads, {
                    searchTerm: 'archive show',
                }).active
            )
        ).toEqual([2]);
        expect(
            rowIds(
                build(downloads, {
                    searchTerm: 'beta source',
                }).attention
            )
        ).toEqual([3]);
        expect(
            libraryItemIds(
                build(downloads, {
                    searchTerm: 's07e08',
                }).library
            )
        ).toEqual([4]);
        expect(
            rowIds(
                build(downloads, {
                    searchTerm: 'checksum mismatch',
                }).attention
            )
        ).toEqual([5]);

        const episode = build(downloads).active.find(
            ({ item }) => item.id === 2
        );
        expect(episode).toMatchObject({
            episodeLabel: 'S01E02',
            seriesTitle: 'Archive Show',
        });
    });

    it('matches a stored movie title when no other search field contains the query', () => {
        const result = build(
            [
                download(1, {
                    title: 'The Stored Needle',
                    status: 'queued',
                }),
            ],
            { searchTerm: 'stored needle' }
        );

        expect(rowIds(result.active)).toEqual([1]);
        expect(result.active[0].item.title).toBe('The Stored Needle');
        expect([
            result.active[0].seriesTitle,
            result.active[0].sourceName,
            result.active[0].episodeLabel,
            result.active[0].item.errorMessage ?? '',
        ]).toEqual(['', 'Alpha Source', '', '']);
    });

    it('derives labels only from usable episode numbers and preserves legacy titles', () => {
        const downloads = [
            download(1, {
                contentType: 'episode',
                title: 'Modern - S03E09 - A title',
                seasonNumber: 3,
                episodeNumber: 9,
                status: 'queued',
            }),
            download(2, {
                contentType: 'episode',
                title: 'Legacy episode title',
                seasonNumber: Number.NaN,
                episodeNumber: 2,
                status: 'queued',
            }),
            download(3, {
                contentType: 'episode',
                title: 'Negative episode',
                seasonNumber: 1,
                episodeNumber: -1,
                status: 'queued',
            }),
            download(4, {
                title: 'Movie title',
                seasonNumber: 1,
                episodeNumber: 2,
                status: 'queued',
            }),
        ];

        expect(
            build(downloads).active.map(
                ({ item, episodeLabel, seriesTitle }) => ({
                    id: item.id,
                    episodeLabel,
                    seriesTitle,
                })
            )
        ).toEqual([
            {
                id: 1,
                episodeLabel: 'S03E09',
                seriesTitle: 'Modern',
            },
            {
                id: 2,
                episodeLabel: '',
                seriesTitle: 'Legacy episode title',
            },
            {
                id: 3,
                episodeLabel: '',
                seriesTitle: 'Negative episode',
            },
            { id: 4, episodeLabel: '', seriesTitle: '' },
        ]);
    });

    it('leaves episode labels blank for fractional and unsafe season or episode numbers', () => {
        const unsafe = Number.MAX_SAFE_INTEGER + 1;
        const result = build([
            download(1, {
                contentType: 'episode',
                seasonNumber: 1.5,
                episodeNumber: 2,
                status: 'queued',
            }),
            download(2, {
                contentType: 'episode',
                seasonNumber: unsafe,
                episodeNumber: 2,
                status: 'queued',
            }),
            download(3, {
                contentType: 'episode',
                seasonNumber: 1,
                episodeNumber: 2.5,
                status: 'queued',
            }),
            download(4, {
                contentType: 'episode',
                seasonNumber: 1,
                episodeNumber: unsafe,
                status: 'queued',
            }),
        ]);

        expect(result.active.map(({ episodeLabel }) => episodeLabel)).toEqual([
            '',
            '',
            '',
            '',
        ]);
    });

    it('partitions every supported status without leaking items between sections', () => {
        const downloads = [
            download(1, { status: 'queued' }),
            download(2, { status: 'downloading' }),
            download(3, { status: 'paused' }),
            download(4, { status: 'failed' }),
            download(5, { status: 'canceled' }),
            download(6, { status: 'completed' }),
        ];

        const result = build(downloads);

        expect(rowIds(result.active)).toEqual([1, 2, 3]);
        expect(rowIds(result.attention)).toEqual([4, 5]);
        expect(libraryItemIds(result.library)).toEqual([6]);
    });

    it('moves missing completed movies to attention instead of the ready library', () => {
        const result = build([
            download(1, { fileAvailability: 'available' }),
            download(2, { fileAvailability: 'missing' }),
        ]);

        expect(rowIds(result.attention)).toEqual([2]);
        expect(result.attention[0].attentionReason).toBe('file-missing');
        expect(libraryItemIds(result.library)).toEqual([1]);
    });

    it('keeps available series members grouped and exposes each missing episode', () => {
        const seriesEpisode = (
            id: number,
            fileAvailability: DownloadItem['fileAvailability']
        ) =>
            download(id, {
                contentType: 'episode',
                episodeNumber: id,
                fileAvailability,
                seasonNumber: 1,
                seriesXtreamId: 70,
            });
        const result = build([
            seriesEpisode(1, 'available'),
            seriesEpisode(2, 'missing'),
            seriesEpisode(3, 'available'),
        ]);

        expect(rowIds(result.attention)).toEqual([2]);
        expect(result.attention[0].attentionReason).toBe('file-missing');
        expect(result.library).toHaveLength(1);
        expect(result.library[0].kind).toBe('series');
        if (result.library[0].kind === 'series') {
            expect(result.library[0].members.map(({ id }) => id)).toEqual([
                1, 3,
            ]);
        }
        expect(result.counts).toEqual({
            all: 2,
            movie: 0,
            series: 2,
            inProgress: 0,
        });
    });

    it('keeps a fully missing series out of Ready to watch', () => {
        const result = build([
            download(1, {
                contentType: 'episode',
                fileAvailability: 'missing',
                seriesXtreamId: 70,
            }),
            download(2, {
                contentType: 'episode',
                fileAvailability: 'missing',
                seriesXtreamId: 70,
            }),
        ]);

        expect(result.library).toEqual([]);
        expect(rowIds(result.attention)).toEqual([1, 2]);
        expect(
            result.attention.map(({ attentionReason }) => attentionReason)
        ).toEqual(['file-missing', 'file-missing']);
    });

    it('filters and searches missing rows without exposing source metadata in the library', () => {
        const downloads = [
            download(1, {
                fileAvailability: 'missing',
                playlistId: 'playlist-b',
            }),
            download(2, {
                contentType: 'episode',
                fileAvailability: 'missing',
                playlistId: 'playlist-b',
            }),
        ];

        expect(
            rowIds(
                build(downloads, {
                    filter: 'movie',
                    searchTerm: 'beta source',
                }).attention
            )
        ).toEqual([1]);
        expect(
            rowIds(
                build(downloads, {
                    filter: 'series',
                    searchTerm: 'beta source',
                }).attention
            )
        ).toEqual([2]);
        expect(build(downloads).counts).toEqual({
            all: 2,
            movie: 1,
            series: 1,
            inProgress: 0,
        });
    });

    it('does not mutate missing-file inputs while partitioning them', () => {
        const available = Object.freeze(
            download(1, { fileAvailability: 'available' })
        );
        const missing = Object.freeze(
            download(2, { fileAvailability: 'missing' })
        );
        const downloads = Object.freeze([available, missing]);

        expect(() => build(downloads)).not.toThrow();
        expect(downloads).toEqual([available, missing]);
        expect(missing).not.toHaveProperty('attentionReason');
    });

    it('excludes paused rows from activeCount independently of filter and search', () => {
        const result = build(
            [
                download(1, { status: 'queued' }),
                download(2, { status: 'downloading' }),
                download(3, { status: 'paused' }),
                download(4, {
                    playlistId: 'playlist-b',
                    status: 'downloading',
                }),
            ],
            {
                scopePlaylistId: 'playlist-a',
                filter: 'movie',
                searchTerm: 'nothing',
            }
        );

        expect(result.activeCount).toBe(2);
        expect(result.active).toEqual([]);
    });

    it('sums scoped tracked bytes and reports whether a row can be cleared', () => {
        const clearable = build(
            [
                download(1, {
                    status: 'queued',
                    bytesDownloaded: undefined,
                }),
                download(2, {
                    status: 'completed',
                    bytesDownloaded: 25,
                }),
                download(3, {
                    playlistId: 'playlist-b',
                    status: 'failed',
                    bytesDownloaded: 100,
                }),
            ],
            { scopePlaylistId: 'playlist-a' }
        );
        const activeOnly = build([
            download(4, { status: 'paused', bytesDownloaded: 4 }),
        ]);

        expect(clearable.trackedBytes).toBe(25);
        expect(clearable.hasClearable).toBe(true);
        expect(activeOnly.trackedBytes).toBe(4);
        expect(activeOnly.hasClearable).toBe(false);
    });

    it.each(['failed', 'canceled'] as const)(
        'makes a %s-only view clearable',
        (status) => {
            const result = build([download(1, { status })]);

            expect(result.hasClearable).toBe(true);
        }
    );

    it('sorts active and attention rows by normalized timestamp then numeric id', () => {
        const downloads = [
            download(9, { status: 'queued', createdAt: undefined }),
            download(7, {
                status: 'downloading',
                createdAt: '2026-01-01T00:00:00Z',
            }),
            download(3, {
                status: 'paused',
                createdAt: '2026-01-01T00:00:00Z',
            }),
            download(10, {
                status: 'queued',
                createdAt: '2025-01-01T00:00:00Z',
            }),
            download(2, {
                status: 'queued',
                createdAt: 'invalid',
            }),
            download(15, {
                status: 'failed',
                createdAt: '2026-02-01T00:00:00Z',
            }),
            download(12, {
                status: 'canceled',
                createdAt: '2026-02-01T00:00:00Z',
            }),
            download(11, {
                status: 'failed',
                createdAt: undefined,
            }),
        ];

        const result = build(downloads);

        expect(rowIds(result.active)).toEqual([2, 9, 10, 3, 7]);
        expect(rowIds(result.attention)).toEqual([11, 12, 15]);
    });

    it('totally orders valid and malformed queue ids independent of input order', () => {
        const createdAt = '2026-01-01T00:00:00Z';
        const cases = [
            { id: 7, title: 'valid-7' },
            { id: Number.NaN, title: 'nan' },
            { id: Number.POSITIVE_INFINITY, title: 'positive-infinity' },
            { id: Number.NEGATIVE_INFINITY, title: 'negative-infinity' },
            { id: -3, title: 'negative' },
            { id: 0, title: 'zero' },
            { id: 42.5, title: 'fractional' },
            { id: Number.MAX_SAFE_INTEGER + 1, title: 'unsafe' },
            { id: 2, title: 'valid-2' },
        ];
        const expected = [
            'valid-2',
            'valid-7',
            'nan',
            'negative-infinity',
            'negative',
            'zero',
            'fractional',
            'unsafe',
            'positive-infinity',
        ];
        const titlesFor = (input: typeof cases) =>
            build(
                input.map(({ id, title }) =>
                    download(id, { title, status: 'queued', createdAt })
                )
            ).active.map(({ item }) => item.title);

        expect(titlesFor(cases)).toEqual(expected);
        expect(titlesFor([...cases].reverse())).toEqual(expected);
    });

    it('sorts completed library entities by newest timestamp then key', () => {
        const result = build([
            download(3, { createdAt: '2025-01-01T00:00:00Z' }),
            download(20, { createdAt: '2025-01-01T00:00:00Z' }),
            download(4, { createdAt: 'invalid' }),
            download(5, { createdAt: '2026-01-01T00:00:00Z' }),
        ]);

        expect(result.library.map(({ key }) => key)).toEqual([
            'movie:5',
            'movie:20',
            'movie:3',
            'movie:4',
        ]);
    });

    it('groups completed episodes only for a positive safe series id', () => {
        const result = build([
            download(1, {
                contentType: 'episode',
                seriesXtreamId: 70,
                seasonNumber: 1,
                episodeNumber: 1,
            }),
            download(2, {
                contentType: 'episode',
                seriesXtreamId: 70,
                seasonNumber: 1,
                episodeNumber: 2,
            }),
        ]);

        expect(result.library).toHaveLength(1);
        expect(result.library[0]).toMatchObject({
            kind: 'series',
            key: 'series:playlist-a:70',
            seriesXtreamId: 70,
        });
    });

    it('keeps identical series ids from different playlists in separate groups', () => {
        const result = build([
            download(1, {
                contentType: 'episode',
                seriesXtreamId: 70,
            }),
            download(2, {
                playlistId: 'playlist-b',
                contentType: 'episode',
                seriesXtreamId: 70,
            }),
        ]);

        expect(result.library.map(({ key }) => key).sort()).toEqual([
            'series:playlist-a:70',
            'series:playlist-b:70',
        ]);
    });

    it.each([
        ['invalid', Number.NaN],
        ['zero', 0],
        ['negative', -1],
        ['fractional', 42.5],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ['missing', undefined],
    ])(
        'keeps an episode with a %s series id as an individual card',
        (_description, seriesXtreamId) => {
            const result = build([
                download(1, {
                    contentType: 'episode',
                    seriesXtreamId,
                    seasonNumber: 1,
                    episodeNumber: 4,
                }),
            ]);

            expect(result.library).toEqual([
                expect.objectContaining({
                    kind: 'episode',
                    key: 'episode:1',
                    episodeLabel: 'S01E04',
                }),
            ]);
            expect('seriesXtreamId' in result.library[0]).toBe(false);
        }
    );

    it('prefers a standardized series prefix and otherwise keeps the first non-empty legacy title', () => {
        const result = build([
            download(1, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
                episodeNumber: 1,
                title: 'Legacy chapter',
            }),
            download(2, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
                episodeNumber: 2,
                title: 'Canonical Show - S01E02 - Second',
            }),
            download(3, {
                contentType: 'episode',
                seriesXtreamId: 20,
                seasonNumber: 1,
                episodeNumber: 1,
                title: '   ',
            }),
            download(4, {
                contentType: 'episode',
                seriesXtreamId: 20,
                seasonNumber: 1,
                episodeNumber: 2,
                title: 'Original legacy title',
            }),
        ]);

        const series = result.library.filter(
            (entity) => entity.kind === 'series'
        );
        expect(
            series.find(({ seriesXtreamId }) => seriesXtreamId === 10)?.title
        ).toBe('Canonical Show');
        expect(
            series.find(({ seriesXtreamId }) => seriesXtreamId === 20)?.title
        ).toBe('Original legacy title');
    });

    it('uses the newest member as representative', () => {
        const result = build([
            download(1, {
                contentType: 'episode',
                seriesXtreamId: 10,
                createdAt: '2026-02-01T00:00:00Z',
            }),
            download(9, {
                contentType: 'episode',
                seriesXtreamId: 10,
                createdAt: '2026-03-01T00:00:00Z',
            }),
            download(8, {
                contentType: 'episode',
                seriesXtreamId: 10,
                createdAt: '2026-03-01T00:00:00Z',
            }),
        ]);

        const [series] = result.library;
        expect(series.kind).toBe('series');
        if (series.kind === 'series') {
            expect(series.representative.id).toBe(9);
            expect(series.newestTimestamp).toBe(
                Date.parse('2026-03-01T00:00:00Z')
            );
        }
    });

    it('uses the newest member with a non-empty poster for series artwork', () => {
        const result = build([
            download(1, {
                contentType: 'episode',
                seriesXtreamId: 10,
                createdAt: '2026-01-01T00:00:00Z',
                posterUrl: 'https://image.test/old.jpg',
            }),
            download(2, {
                contentType: 'episode',
                seriesXtreamId: 10,
                createdAt: '2026-02-01T00:00:00Z',
                posterUrl: 'https://image.test/new.jpg',
            }),
            download(3, {
                contentType: 'episode',
                seriesXtreamId: 10,
                createdAt: '2026-03-01T00:00:00Z',
                posterUrl: '   ',
            }),
        ]);

        expect(result.library[0]).toMatchObject({
            kind: 'series',
            posterUrl: 'https://image.test/new.jpg',
        });
    });

    it('orders series members by season, episode, timestamp, then id with invalid numbers last', () => {
        const episodes = [
            download(9, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: undefined,
                episodeNumber: 1,
            }),
            download(8, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 2,
                episodeNumber: 1,
            }),
            download(7, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
                episodeNumber: undefined,
            }),
            download(6, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
                episodeNumber: 1,
                createdAt: '2026-01-01T00:00:00Z',
            }),
            download(5, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
                episodeNumber: 1,
                createdAt: '2025-01-01T00:00:00Z',
            }),
            download(4, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
                episodeNumber: 1,
                createdAt: '2025-01-01T00:00:00Z',
            }),
            download(3, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
                episodeNumber: 2,
            }),
        ];

        const [series] = build(episodes).library;
        expect(series.kind).toBe('series');
        if (series.kind === 'series') {
            expect(series.members.map(({ id }) => id)).toEqual([
                4, 5, 6, 3, 7, 8, 9,
            ]);
        }
    });

    it('derives the usable season range for a series', () => {
        const [series] = build([
            download(1, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 4,
            }),
            download(2, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: Number.POSITIVE_INFINITY,
            }),
            download(3, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
            }),
            download(4, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: -1,
            }),
        ]).library;

        expect(series).toMatchObject({
            kind: 'series',
            firstSeason: 1,
            lastSeason: 4,
        });
    });

    it('aggregates tracked bytes across every member of a series', () => {
        const [series] = build([
            download(1, {
                contentType: 'episode',
                seriesXtreamId: 10,
                bytesDownloaded: 30,
            }),
            download(2, {
                contentType: 'episode',
                seriesXtreamId: 10,
                bytesDownloaded: undefined,
            }),
            download(3, {
                contentType: 'episode',
                seriesXtreamId: 10,
                bytesDownloaded: 12,
            }),
        ]).library;

        expect(series).toMatchObject({
            kind: 'series',
            trackedBytes: 42,
        });
    });

    it('does not mutate input arrays or objects while sorting and grouping', () => {
        const first = Object.freeze(
            download(2, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 2,
            })
        );
        const second = Object.freeze(
            download(1, {
                contentType: 'episode',
                seriesXtreamId: 10,
                seasonNumber: 1,
            })
        );
        const downloads = Object.freeze([first, second]);
        const playlist = Object.freeze({
            _id: 'playlist-a',
            title: 'Alpha Source',
        });
        const playlists = Object.freeze([playlist]);

        const result = build(downloads, { playlists });

        expect(downloads).toEqual([first, second]);
        expect(playlists).toEqual([playlist]);
        expect(result.scopedItems[0]).toBe(first);
        const [series] = result.library;
        expect(series.kind).toBe('series');
        if (series.kind === 'series') {
            expect(series.members.map(({ id }) => id)).toEqual([1, 2]);
        }
    });
});
