import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
    DatabaseService,
    DownloadsService,
    PlaylistsService,
    SettingsStore,
    TMDB_DETAILS_CACHE_TTL_MS,
    TmdbEnrichmentService,
    type TmdbMovieDetails,
    type TmdbTvDetails,
    type XtreamContent,
} from '@iptvnator/services';
import type {
    DownloadMetadataSnapshot,
    Playlist,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import type { DownloadItem } from '@iptvnator/services';
import type { DownloadOfflineDetail } from './download-offline-detail.viewmodel';
import { DownloadOfflineMetadataService } from './download-offline-metadata.service';

const PLAYLIST_ID = 'playlist-a';
const NOW = '2026-07-31T08:30:00.000Z';
const XTREAM_PLAYLIST = {
    _id: PLAYLIST_ID,
    title: 'Xtream source',
    importDate: NOW,
    lastUsage: NOW,
    count: 0,
    autoRefresh: false,
    portalUrl: 'https://xtream.example.test',
} satisfies Playlist;
const STALKER_PLAYLIST = {
    ...XTREAM_PLAYLIST,
    title: 'Stalker source',
    portalUrl: 'https://stalker.example.test',
    macAddress: '00:1A:79:12:34:56',
} satisfies Playlist;

type DatabaseFake = jest.Mocked<Pick<DatabaseService, 'getContentByXtreamId'>>;
type DownloadsFake = jest.Mocked<Pick<DownloadsService, 'updateMetadata'>>;
type PlaylistsFake = jest.Mocked<
    Pick<PlaylistsService, 'getPlaylistById' | 'getPortalRecentlyViewed'>
>;
type TmdbFake = jest.Mocked<
    Pick<TmdbEnrichmentService, 'isEnabled' | 'enrichMovie' | 'enrichTv'>
>;

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function providerContent(
    title: string,
    xtreamId: number,
    type: 'movie' | 'series' = 'movie'
): XtreamContent {
    return {
        id: xtreamId,
        category_id: 12,
        title,
        rating: '7',
        added: '0',
        poster_url: 'https://images.example.test/provider.jpg',
        xtream_id: xtreamId,
        type,
    };
}

function download(overrides: Partial<DownloadItem> = {}): DownloadItem {
    return {
        id: 17,
        playlistId: PLAYLIST_ID,
        xtreamId: 41,
        contentType: 'vod',
        title: 'Downloaded fallback title',
        url: 'https://stream.example.test/movie/41.m3u8',
        posterUrl: 'https://images.example.test/download.jpg',
        status: 'completed',
        fileAvailability: 'available',
        filePath: '/downloads/movie.mp4',
        ...overrides,
    };
}

function snapshot(
    overrides: Partial<DownloadMetadataSnapshot> = {}
): DownloadMetadataSnapshot {
    return {
        version: 1,
        language: 'en',
        mediaKind: 'movie',
        title: 'Local title',
        plot: 'Rich local plot',
        posterUrl: 'https://images.example.test/local.jpg',
        providerCategoryId: '4',
        enrichedAt: new Date().toISOString(),
        ...overrides,
    };
}

function movieDetail(
    itemOverrides: Partial<DownloadItem> = {},
    snapshotOverride?: DownloadMetadataSnapshot
): DownloadOfflineDetail {
    const item = download({
        ...itemOverrides,
        ...(snapshotOverride === undefined
            ? {}
            : { metadataSnapshot: snapshotOverride }),
    });
    return {
        kind: 'movie',
        item,
        ...(snapshotOverride === undefined
            ? {}
            : { snapshot: snapshotOverride }),
    };
}

function seriesDetail(
    seriesSnapshot: DownloadMetadataSnapshot,
    itemOverrides: Partial<DownloadItem> = {}
): DownloadOfflineDetail {
    const representative = download({
        contentType: 'episode',
        xtreamId: 501,
        seriesXtreamId: 93,
        seasonNumber: 2,
        episodeNumber: 7,
        title: 'Series - S02E07 - Relay',
        ...itemOverrides,
        metadataSnapshot: seriesSnapshot,
    });
    return {
        kind: 'series',
        representative,
        snapshot: seriesSnapshot,
        seasons: [
            {
                seasonNumber: 2,
                seasonNumberState: 'known',
                episodes: [
                    {
                        item: representative,
                        seasonNumber: 2,
                        seasonNumberState: 'known',
                        episodeNumber: 7,
                        episodeNumberState: 'known',
                        episodeMetadata: seriesSnapshot.episode,
                    },
                ],
            },
        ],
    };
}

const tmdbMovie: TmdbMovieDetails = {
    id: 603,
    overview: 'Localized TMDB movie plot',
    poster_path: '/movie.jpg',
};
const tmdbTv: TmdbTvDetails = {
    id: 900,
    overview: 'Localized TMDB series plot',
    poster_path: '/series.jpg',
};

describe('DownloadOfflineMetadataService', () => {
    let service: DownloadOfflineMetadataService;
    let db: DatabaseFake;
    let downloads: DownloadsFake;
    let playlists: PlaylistsFake;
    let tmdb: TmdbFake;
    let currentLanguage: string;

    beforeEach(() => {
        db = {
            getContentByXtreamId: jest.fn().mockResolvedValue(null),
        };
        downloads = {
            updateMetadata: jest.fn().mockResolvedValue({ success: true }),
        };
        playlists = {
            getPlaylistById: jest.fn().mockReturnValue(of(XTREAM_PLAYLIST)),
            getPortalRecentlyViewed: jest.fn().mockReturnValue(of([])),
        };
        tmdb = {
            isEnabled: jest.fn().mockReturnValue(false),
            enrichMovie: jest.fn().mockResolvedValue(null),
            enrichTv: jest.fn().mockResolvedValue(null),
        };
        currentLanguage = 'en';

        TestBed.configureTestingModule({
            providers: [
                DownloadOfflineMetadataService,
                { provide: DatabaseService, useValue: db },
                { provide: DownloadsService, useValue: downloads },
                { provide: PlaylistsService, useValue: playlists },
                { provide: TmdbEnrichmentService, useValue: tmdb },
                {
                    provide: SettingsStore,
                    useValue: { language: () => currentLanguage },
                },
            ],
        });
        service = TestBed.inject(DownloadOfflineMetadataService);
    });

    it('returns a rich fresh current-language snapshot without provider lookup', async () => {
        const local = snapshot();

        await expect(service.resolve(movieDetail({}, local))).resolves.toEqual(
            local
        );

        expect(playlists.getPlaylistById).not.toHaveBeenCalled();
        expect(playlists.getPortalRecentlyViewed).not.toHaveBeenCalled();
        expect(db.getContentByXtreamId).not.toHaveBeenCalled();
        expect(tmdb.enrichMovie).not.toHaveBeenCalled();
        expect(downloads.updateMetadata).not.toHaveBeenCalled();
    });

    it('recovers a sparse Stalker legacy row from its matching recent item', async () => {
        playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
        const recent = {
            movie_id: '41:archive',
            category_id: 'vod',
            title: 'Stalker provider title',
            cover: 'https://images.example.test/stalker-provider.jpg',
            description: 'Stalker provider plot',
        } satisfies StalkerPortalItem & { description: string };
        playlists.getPortalRecentlyViewed.mockReturnValue(of([recent]));

        const resolved = await service.resolve(
            movieDetail({}, snapshot({ plot: undefined, posterUrl: undefined }))
        );

        expect(playlists.getPortalRecentlyViewed).toHaveBeenCalledWith(
            PLAYLIST_ID
        );
        expect(resolved.title).toBe('Stalker provider title');
        expect(resolved.plot).toBe('Stalker provider plot');
        expect(resolved.posterUrl).toBe(
            'https://images.example.test/stalker-provider.jpg'
        );
        expect(db.getContentByXtreamId).not.toHaveBeenCalled();
    });

    it('does not recover series metadata from a movie with an overlapping Stalker ID', async () => {
        playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
        playlists.getPortalRecentlyViewed.mockReturnValue(
            of([
                {
                    movie_id: '93',
                    category_id: 'vod',
                    title: 'Wrong movie metadata',
                },
                {
                    series_id: '93',
                    category_id: 'series',
                    title: 'Correct series metadata',
                },
            ])
        );
        const local = snapshot({
            mediaKind: 'series',
            title: 'Local series',
            plot: undefined,
            episode: {
                title: 'Downloaded episode',
                seasonNumber: 2,
                episodeNumber: 7,
            },
        });

        const resolved = await service.resolve(seriesDetail(local));

        expect(resolved.title).toBe('Correct series metadata');
        expect(resolved.title).not.toBe('Wrong movie metadata');
    });

    it('recovers a sparse Xtream row through the database content lookup', async () => {
        db.getContentByXtreamId.mockResolvedValue({
            id: 1,
            category_id: 12,
            title: 'Xtream provider title',
            rating: '7.5',
            added: '0',
            poster_url: 'https://images.example.test/xtream-provider.jpg',
            xtream_id: 41,
            type: 'movie',
        });

        const resolved = await service.resolve(movieDetail());

        expect(db.getContentByXtreamId).toHaveBeenCalledWith(
            41,
            PLAYLIST_ID,
            'movie'
        );
        expect(resolved.title).toBe('Xtream provider title');
        expect(resolved.providerCategoryId).toBe('12');
        expect(resolved.posterUrl).toBe(
            'https://images.example.test/xtream-provider.jpg'
        );
        expect(playlists.getPortalRecentlyViewed).not.toHaveBeenCalled();
    });

    it('uses the series discriminator for an offline episode lookup', async () => {
        const local = snapshot({
            mediaKind: 'series',
            plot: undefined,
            episode: {
                title: 'Downloaded episode',
                seasonNumber: 2,
                episodeNumber: 7,
            },
        });

        await service.resolve(seriesDetail(local));

        expect(db.getContentByXtreamId).toHaveBeenCalledWith(
            93,
            PLAYLIST_ID,
            'series'
        );
    });

    it.each([
        ['movie', 'enrichMovie'] as const,
        ['series', 'enrichTv'] as const,
    ])('uses %s TMDB enrichment when enabled', async (kind, method) => {
        tmdb.isEnabled.mockReturnValue(true);
        tmdb.enrichMovie.mockResolvedValue(tmdbMovie);
        tmdb.enrichTv.mockResolvedValue(tmdbTv);
        db.getContentByXtreamId.mockResolvedValue({
            id: 1,
            category_id: 12,
            title: `Provider ${kind}`,
            rating: '',
            added: '0',
            poster_url: '',
            xtream_id: kind === 'movie' ? 41 : 93,
            type: kind,
        });
        const localSeries = snapshot({
            mediaKind: 'series',
            title: 'Local series',
            plot: undefined,
            episode: {
                title: 'Local episode',
                seasonNumber: 2,
                episodeNumber: 7,
            },
        });
        const detail =
            kind === 'movie' ? movieDetail() : seriesDetail(localSeries);

        const resolved = await service.resolve(detail);

        expect(tmdb[method]).toHaveBeenCalledWith(
            expect.objectContaining({ title: `Provider ${kind}` })
        );
        expect(resolved.plot).toBe(
            kind === 'movie'
                ? 'Localized TMDB movie plot'
                : 'Localized TMDB series plot'
        );
    });

    it('keeps provider metadata when TMDB is disabled', async () => {
        db.getContentByXtreamId.mockResolvedValue({
            id: 1,
            category_id: 12,
            title: 'Provider title',
            rating: '7',
            added: '0',
            poster_url: 'https://images.example.test/provider.jpg',
            xtream_id: 41,
            type: 'movie',
        });

        const resolved = await service.resolve(movieDetail());

        expect(resolved.title).toBe('Provider title');
        expect(resolved.posterUrl).toBe(
            'https://images.example.test/provider.jpg'
        );
        expect(tmdb.enrichMovie).not.toHaveBeenCalled();
    });

    it('keeps provider metadata when TMDB rejects', async () => {
        tmdb.isEnabled.mockReturnValue(true);
        tmdb.enrichMovie.mockRejectedValue(new Error('TMDB unavailable'));
        db.getContentByXtreamId.mockResolvedValue({
            id: 1,
            category_id: 12,
            title: 'Provider title',
            rating: '7',
            added: '0',
            poster_url: 'https://images.example.test/provider.jpg',
            xtream_id: 41,
            type: 'movie',
        });

        await expect(service.resolve(movieDetail())).resolves.toEqual(
            expect.objectContaining({
                title: 'Provider title',
                posterUrl: 'https://images.example.test/provider.jpg',
            })
        );
    });

    it('keeps Stalker merge precedence when recent lookup fails', async () => {
        playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
        playlists.getPortalRecentlyViewed.mockReturnValue(
            throwError(() => new Error('recent unavailable'))
        );
        tmdb.isEnabled.mockReturnValue(true);
        tmdb.enrichMovie.mockResolvedValue({
            id: 603,
            overview: 'Localized TMDB plot',
            vote_average: 7.2,
            vote_count: 100,
        });
        const local = snapshot({ plot: undefined, rating: 9.1 });

        const resolved = await service.resolve(movieDetail({}, local));

        expect(resolved.plot).toBe('Localized TMDB plot');
        expect(resolved.rating).toBe(9.1);
        expect(db.getContentByXtreamId).not.toHaveBeenCalled();
    });

    it('labels a provider-missing successful TMDB refresh with the current language', async () => {
        currentLanguage = 'de';
        tmdb.isEnabled.mockReturnValue(true);
        tmdb.enrichMovie.mockResolvedValue({
            id: 603,
            overview: 'Lokalisierte TMDB-Beschreibung',
        });
        const local = snapshot({ language: 'en' });

        const resolved = await service.resolve(movieDetail({}, local));

        expect(db.getContentByXtreamId).toHaveBeenCalledWith(
            41,
            PLAYLIST_ID,
            'movie'
        );
        expect(resolved.language).toBe('de');
        expect(downloads.updateMetadata).toHaveBeenCalledWith(
            17,
            expect.objectContaining({ language: 'de' })
        );
    });

    it('does not relabel a mismatched snapshot when no refresh succeeds', async () => {
        currentLanguage = 'de';
        const local = snapshot({ language: 'en' });

        await expect(service.resolve(movieDetail({}, local))).resolves.toEqual(
            local
        );
        expect(downloads.updateMetadata).not.toHaveBeenCalled();
    });

    it('omits credential-bearing provider artwork before persistence', async () => {
        db.getContentByXtreamId.mockResolvedValue({
            id: 1,
            category_id: 12,
            title: 'Recovered provider title',
            rating: '7',
            added: '0',
            poster_url:
                'https://images.example.test/authorization/value/poster.jpg',
            xtream_id: 41,
            type: 'movie',
        });
        const local = snapshot({ plot: undefined, posterUrl: undefined });

        const resolved = await service.resolve(movieDetail({}, local));

        expect(resolved.posterUrl).toBeUndefined();
        expect(downloads.updateMetadata).toHaveBeenCalledWith(
            17,
            expect.not.objectContaining({ posterUrl: expect.anything() })
        );
    });

    it('persists one materially changed successful merge', async () => {
        tmdb.isEnabled.mockReturnValue(true);
        tmdb.enrichMovie.mockResolvedValue(tmdbMovie);
        const local = snapshot({ plot: undefined });

        const resolved = await service.resolve(movieDetail({}, local));

        expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);
        expect(downloads.updateMetadata).toHaveBeenCalledWith(17, resolved);
    });

    it('persists a materially identical successful TMDB refresh once', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(NOW));
        try {
            tmdb.isEnabled.mockReturnValue(true);
            tmdb.enrichMovie.mockResolvedValue({ id: 603 });
            const local = snapshot({
                tmdbId: 603,
                rating: 0,
                enrichedAt: '2020-01-01T00:00:00.000Z',
            });

            const refreshed = await service.resolve(movieDetail({}, local));

            expect(refreshed.enrichedAt).toBe(NOW);
            expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);
            expect(downloads.updateMetadata).toHaveBeenCalledWith(
                17,
                refreshed
            );

            await service.resolve(movieDetail({}, refreshed));

            expect(tmdb.enrichMovie).toHaveBeenCalledTimes(1);
            expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('throttles a successful sparse provider refresh per language during reload', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(NOW));
        try {
            db.getContentByXtreamId.mockResolvedValue({
                ...providerContent('Local title', 41),
                category_id: 4,
                poster_url: '',
            });
            const local = snapshot({
                plot: undefined,
                posterUrl: undefined,
                backdropUrl: undefined,
                enrichedAt: '2020-01-01T00:00:00.000Z',
            });
            downloads.updateMetadata.mockImplementationOnce(
                async (_downloadId, refreshed) => {
                    await service.resolve(movieDetail({}, refreshed));
                    return { success: true };
                }
            );

            const refreshed = await service.resolve(movieDetail({}, local));

            expect(refreshed.plot).toBeUndefined();
            expect(refreshed.posterUrl).toBeUndefined();
            expect(db.getContentByXtreamId).toHaveBeenCalledTimes(1);
            expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);

            currentLanguage = 'de';
            const translated = await service.resolve(
                movieDetail({}, refreshed)
            );

            expect(translated.language).toBe('de');
            expect(db.getContentByXtreamId).toHaveBeenCalledTimes(2);
            expect(downloads.updateMetadata).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('throttles a successful sparse materially identical TMDB refresh', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(NOW));
        try {
            tmdb.isEnabled.mockReturnValue(true);
            tmdb.enrichMovie.mockResolvedValue({ id: 603 });
            const local = snapshot({
                plot: undefined,
                posterUrl: undefined,
                backdropUrl: undefined,
                tmdbId: 603,
                rating: 0,
                enrichedAt: '2020-01-01T00:00:00.000Z',
            });

            const refreshed = await service.resolve(movieDetail({}, local));
            await service.resolve(movieDetail({}, refreshed));

            expect(tmdb.enrichMovie).toHaveBeenCalledTimes(1);
            expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('retries a sparse transient TMDB failure', async () => {
        tmdb.isEnabled.mockReturnValue(true);
        tmdb.enrichMovie.mockRejectedValue(new Error('TMDB unavailable'));
        const local = snapshot({
            plot: undefined,
            posterUrl: undefined,
            backdropUrl: undefined,
            enrichedAt: '2020-01-01T00:00:00.000Z',
        });

        await service.resolve(movieDetail({}, local));
        await service.resolve(movieDetail({}, local));

        expect(tmdb.enrichMovie).toHaveBeenCalledTimes(2);
        expect(downloads.updateMetadata).not.toHaveBeenCalled();
    });

    it('expires a completed sparse refresh throttle with the TMDB TTL', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(NOW));
        try {
            db.getContentByXtreamId.mockResolvedValue({
                ...providerContent('Local title', 41),
                category_id: 4,
                poster_url: '',
            });
            const local = snapshot({
                plot: undefined,
                posterUrl: undefined,
                backdropUrl: undefined,
                enrichedAt: '2020-01-01T00:00:00.000Z',
            });

            const refreshed = await service.resolve(movieDetail({}, local));
            await service.resolve(movieDetail({}, refreshed));
            jest.advanceTimersByTime(TMDB_DETAILS_CACHE_TTL_MS + 1);
            await service.resolve(movieDetail({}, refreshed));

            expect(db.getContentByXtreamId).toHaveBeenCalledTimes(2);
            expect(downloads.updateMetadata).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('persists provider metadata without marking a failed TMDB refresh current', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(NOW));
        try {
            currentLanguage = 'de';
            tmdb.isEnabled.mockReturnValue(true);
            tmdb.enrichMovie.mockRejectedValue(
                new Error('TMDB temporarily unavailable')
            );
            db.getContentByXtreamId.mockResolvedValue(
                providerContent('Recovered provider title', 41)
            );
            const local = snapshot({
                language: 'en',
                enrichedAt: '2020-01-01T00:00:00.000Z',
            });

            const resolved = await service.resolve(movieDetail({}, local));

            expect(resolved.title).toBe('Recovered provider title');
            expect(resolved.language).toBe('en');
            expect(resolved.enrichedAt).toBe(local.enrichedAt);
            expect(downloads.updateMetadata).toHaveBeenCalledWith(17, resolved);

            await service.resolve(movieDetail({}, resolved));

            expect(tmdb.enrichMovie).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('marks a successful provider-only refresh fresh when TMDB is disabled', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(NOW));
        try {
            db.getContentByXtreamId.mockResolvedValue({
                ...providerContent('Local title', 41),
                category_id: 4,
                rating: '',
                poster_url: 'https://images.example.test/local.jpg',
            });
            const local = snapshot({
                enrichedAt: '2020-01-01T00:00:00.000Z',
            });

            const refreshed = await service.resolve(movieDetail({}, local));

            expect(refreshed.enrichedAt).toBe(NOW);
            expect(downloads.updateMetadata).toHaveBeenCalledWith(
                17,
                refreshed
            );

            await service.resolve(movieDetail({}, refreshed));

            expect(db.getContentByXtreamId).toHaveBeenCalledTimes(1);
            expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('retains stale language and freshness when provider and TMDB fail', async () => {
        currentLanguage = 'de';
        tmdb.isEnabled.mockReturnValue(true);
        tmdb.enrichMovie.mockRejectedValue(new Error('TMDB unavailable'));
        db.getContentByXtreamId.mockRejectedValue(
            new Error('Provider unavailable')
        );
        const local = snapshot({
            language: 'en',
            enrichedAt: '2020-01-01T00:00:00.000Z',
        });

        await expect(service.resolve(movieDetail({}, local))).resolves.toEqual(
            local
        );
        expect(downloads.updateMetadata).not.toHaveBeenCalled();
    });

    it('preserves local episode metadata and does not fabricate a series episode list', async () => {
        tmdb.isEnabled.mockReturnValue(true);
        tmdb.enrichTv.mockResolvedValue({
            ...tmdbTv,
            seasons: [{ season_number: 1, episode_count: 99 }],
            episodes: [{ season_number: 1, episode_number: 1 }],
        } as TmdbTvDetails & Record<string, unknown>);
        const local = snapshot({
            mediaKind: 'series',
            title: 'Local series',
            plot: undefined,
            episode: {
                title: 'Downloaded episode',
                plot: 'Local episode plot',
                seasonNumber: 2,
                episodeNumber: 7,
            },
        });

        const resolved = await service.resolve(seriesDetail(local));

        expect(resolved.episode).toEqual(local.episode);
        expect(resolved).not.toHaveProperty('episodes');
        expect(resolved).not.toHaveProperty('seasons');
    });

    it('does not fabricate episode coordinates for a sparse legacy series row', async () => {
        const representative = download({
            contentType: 'episode',
            xtreamId: 501,
            seriesXtreamId: 93,
            title: 'Legacy series episode',
        });
        const detail: DownloadOfflineDetail = {
            kind: 'series',
            representative,
            seasons: [
                {
                    seasonNumber: null,
                    seasonNumberState: 'unknown',
                    episodes: [
                        {
                            item: representative,
                            seasonNumber: null,
                            seasonNumberState: 'unknown',
                            episodeNumber: null,
                            episodeNumberState: 'unknown',
                        },
                    ],
                },
            ],
        };

        const resolved = await service.resolve(detail);

        expect(resolved.mediaKind).toBe('series');
        expect(resolved).not.toHaveProperty('episode');
    });

    it('does not persist an older movie resolve after a newer generation', async () => {
        const olderProvider = deferred<XtreamContent | null>();
        const newerProvider = deferred<XtreamContent | null>();
        db.getContentByXtreamId
            .mockImplementationOnce(() => olderProvider.promise)
            .mockImplementationOnce(() => newerProvider.promise);
        const local = snapshot({ enrichedAt: '2020-01-01T00:00:00.000Z' });
        const detail = movieDetail({}, local);

        const olderResolve = service.resolve(detail);
        const newerResolve = service.resolve(detail);
        newerProvider.resolve(providerContent('Newer provider title', 41));
        const newerResult = await newerResolve;
        olderProvider.resolve(providerContent('Older provider title', 41));
        const olderResult = await olderResolve;

        expect(newerResult.title).toBe('Newer provider title');
        expect(olderResult.title).toBe('Older provider title');
        expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);
        expect(downloads.updateMetadata).toHaveBeenCalledWith(17, newerResult);
    });

    it('guards persistence across different episodes in one series group', async () => {
        const olderProvider = deferred<XtreamContent | null>();
        const newerProvider = deferred<XtreamContent | null>();
        db.getContentByXtreamId
            .mockImplementationOnce(() => olderProvider.promise)
            .mockImplementationOnce(() => newerProvider.promise);
        const olderSnapshot = snapshot({
            mediaKind: 'series',
            title: 'Local series',
            enrichedAt: '2020-01-01T00:00:00.000Z',
            episode: {
                title: 'Older episode',
                seasonNumber: 2,
                episodeNumber: 7,
            },
        });
        const newerSnapshot = {
            ...olderSnapshot,
            episode: {
                title: 'Newer episode',
                seasonNumber: 2,
                episodeNumber: 8,
            },
        };
        const olderDetail = seriesDetail(olderSnapshot);
        const newerDetail = seriesDetail(newerSnapshot, {
            id: 18,
            xtreamId: 502,
            episodeNumber: 8,
            title: 'Series - S02E08 - Newer episode',
        });

        const olderResolve = service.resolve(olderDetail);
        const newerResolve = service.resolve(newerDetail);
        newerProvider.resolve(
            providerContent('Newer series title', 93, 'series')
        );
        const newerResult = await newerResolve;
        olderProvider.resolve(
            providerContent('Older series title', 93, 'series')
        );
        const olderResult = await olderResolve;

        expect(newerResult.title).toBe('Newer series title');
        expect(olderResult.title).toBe('Older series title');
        expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);
        expect(downloads.updateMetadata).toHaveBeenCalledWith(18, newerResult);
    });

    it('returns the best local metadata when provider lookup fails', async () => {
        playlists.getPlaylistById.mockReturnValue(
            throwError(() => new Error('playlist unavailable'))
        );
        const local = snapshot({ plot: undefined });

        await expect(service.resolve(movieDetail({}, local))).resolves.toEqual(
            local
        );
        expect(downloads.updateMetadata).not.toHaveBeenCalled();
    });

    it('returns changed metadata when best-effort persistence fails', async () => {
        downloads.updateMetadata.mockRejectedValue(
            new Error('persistence unavailable')
        );
        db.getContentByXtreamId.mockResolvedValue({
            id: 1,
            category_id: 12,
            title: 'Recovered provider title',
            rating: '7',
            added: '0',
            poster_url: 'https://images.example.test/provider.jpg',
            xtream_id: 41,
            type: 'movie',
        });

        await expect(service.resolve(movieDetail())).resolves.toEqual(
            expect.objectContaining({ title: 'Recovered provider title' })
        );
        expect(downloads.updateMetadata).toHaveBeenCalledTimes(1);
    });
});
