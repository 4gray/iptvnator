import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER,
    PortalCatalogSortMode,
} from '@iptvnator/portal/shared/util';
import {
    XtreamPlaylistData,
    XtreamApiService,
    XtreamUrlService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { DatabaseService, MediaMetadataService, SettingsStore } from 'services';
import { XtreamCatalogFacadeService } from './xtream-catalog-facade.service';

const PLAYLIST_ONE: XtreamPlaylistData = {
    id: 'playlist-1',
    name: 'Playlist One',
    title: 'Playlist One',
    serverUrl: 'http://localhost:3000',
    username: 'user',
    password: 'secret',
    type: 'xtream',
};

const PLAYLIST_TWO: XtreamPlaylistData = {
    ...PLAYLIST_ONE,
    id: 'playlist-2',
    name: 'Playlist Two',
    title: 'Playlist Two',
};

describe('XtreamCatalogFacadeService', () => {
    let service: XtreamCatalogFacadeService;
    const contentType = signal<'live' | 'vod' | 'series'>('vod');
    const limit = signal(25);
    const page = signal(0);
    const selectedCategory = signal<Record<string, unknown> | null>({
        id: 11,
        name: 'Movies',
    });
    const selectedCategoryId = signal<number | null>(11);
    const paginatedContent = signal<Record<string, unknown>[]>([
        { xtream_id: 1, title: 'A' },
    ]);
    const selectedCategoryItems = signal<Record<string, unknown>[]>([
        { xtream_id: 1, title: 'A' },
        { xtream_id: 2, title: 'B' },
    ]);
    const selectedItem = signal<Record<string, unknown> | null>(null);
    const totalPages = signal(1);
    const isPaginatedContentLoading = signal(false);
    const contentSortMode = signal<PortalCatalogSortMode>('date-desc');
    const languageFilter = signal(EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER);
    const languageFilterOptions = signal([{ code: 'it', label: 'Italiano' }]);
    const languageFilterActive = signal(false);
    const videoQualityFilter = signal<'all' | '2160p'>('all');
    const videoQualityFilterOptions = signal([
        { value: '2160p' as const, label: '2160p+', count: 2 },
    ]);
    const videoQualityFilterActive = signal(false);
    const currentPlaylist = signal<XtreamPlaylistData | null>(PLAYLIST_ONE);
    const liveStreams = signal<Record<string, unknown>[]>([]);
    const vodStreams = signal<Record<string, unknown>[]>([]);
    const serialStreams = signal<Record<string, unknown>[]>([]);
    const backgroundMetadataWarmup = signal(false);
    const backgroundMetadataWarmupSchedule = signal<
        'every-opening' | 'weekly' | 'monthly'
    >('weekly');
    const backgroundMetadataWarmupConcurrency = signal(2);
    const mediaMetadataProbe = jest.fn();
    const constructLiveUrl = jest.fn();
    const constructVodUrl = jest.fn();
    const constructEpisodeUrl = jest.fn();
    const getSeriesInfo = jest.fn();
    const setXtreamContentMediaMetadata = jest.fn();

    const xtreamStore = {
        selectedContentType: contentType,
        limit,
        page,
        getSelectedCategory: selectedCategory,
        selectedCategoryId,
        getPaginatedContent: paginatedContent,
        selectItemsFromSelectedCategory: selectedCategoryItems,
        selectedItem,
        getTotalPages: totalPages,
        isPaginatedContentLoading,
        contentSortMode,
        languageFilter,
        languageFilterOptions,
        languageFilterActive,
        videoQualityFilter,
        videoQualityFilterOptions,
        videoQualityFilterActive,
        currentPlaylist,
        liveStreams,
        vodStreams,
        serialStreams,
        loadAllPositions: jest.fn(),
        setCategorySearchTerm: jest.fn(),
        setSelectedItem: jest.fn((item: Record<string, unknown> | null) => {
            selectedItem.set(item);
        }),
        setSelectedCategory: jest.fn((categoryId: number | null) => {
            selectedCategoryId.set(categoryId);
        }),
        setPage: jest.fn((nextPage: number) => {
            page.set(nextPage);
        }),
        setLimit: jest.fn((nextLimit: number) => {
            limit.set(nextLimit);
        }),
        setContentSortMode: jest.fn((mode: PortalCatalogSortMode) => {
            contentSortMode.set(mode);
        }),
        toggleLanguageFilterOption: jest.fn(),
        selectAllLanguageFilterOptions: jest.fn(),
        clearLanguageFilterOptions: jest.fn(),
        invertLanguageFilterOptions: jest.fn(),
        resetLanguageFilter: jest.fn(),
        setVideoQualityFilter: jest.fn(),
        resetVideoQualityFilter: jest.fn(),
        setContentMediaMetadata: jest.fn(),
        hasSeriesProgress: jest.fn().mockReturnValue(false),
        getProgressPercent: jest.fn().mockReturnValue(40),
        isWatched: jest.fn().mockReturnValue(false),
    };

    beforeEach(() => {
        localStorage.removeItem('xtream-category-sort-mode');
        contentType.set('vod');
        limit.set(25);
        page.set(0);
        selectedCategory.set({ id: 11, name: 'Movies' });
        selectedCategoryId.set(11);
        paginatedContent.set([{ xtream_id: 1, title: 'A' }]);
        selectedCategoryItems.set([
            { xtream_id: 1, title: 'A' },
            { xtream_id: 2, title: 'B' },
        ]);
        selectedItem.set(null);
        totalPages.set(1);
        isPaginatedContentLoading.set(false);
        contentSortMode.set('date-desc');
        languageFilter.set(EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER);
        languageFilterOptions.set([{ code: 'it', label: 'Italiano' }]);
        languageFilterActive.set(false);
        videoQualityFilter.set('all');
        videoQualityFilterOptions.set([
            { value: '2160p', label: '2160p+', count: 2 },
        ]);
        videoQualityFilterActive.set(false);
        currentPlaylist.set(PLAYLIST_ONE);
        liveStreams.set([]);
        vodStreams.set([]);
        serialStreams.set([]);
        backgroundMetadataWarmup.set(false);
        backgroundMetadataWarmupSchedule.set('weekly');
        backgroundMetadataWarmupConcurrency.set(2);

        xtreamStore.loadAllPositions.mockClear();
        xtreamStore.setCategorySearchTerm.mockClear();
        xtreamStore.setSelectedItem.mockClear();
        xtreamStore.setSelectedCategory.mockClear();
        xtreamStore.setPage.mockClear();
        xtreamStore.setLimit.mockClear();
        xtreamStore.setContentSortMode.mockClear();
        xtreamStore.toggleLanguageFilterOption.mockClear();
        xtreamStore.selectAllLanguageFilterOptions.mockClear();
        xtreamStore.clearLanguageFilterOptions.mockClear();
        xtreamStore.invertLanguageFilterOptions.mockClear();
        xtreamStore.resetLanguageFilter.mockClear();
        xtreamStore.setVideoQualityFilter.mockClear();
        xtreamStore.resetVideoQualityFilter.mockClear();
        xtreamStore.setContentMediaMetadata.mockClear();
        xtreamStore.hasSeriesProgress.mockClear();
        xtreamStore.getProgressPercent.mockClear();
        xtreamStore.isWatched.mockClear();
        mediaMetadataProbe.mockReset();
        mediaMetadataProbe.mockResolvedValue({
            available: true,
            qualityLabel: '2160p HEVC',
            height: 2160,
            audioLanguages: ['ITA'],
            audioCodecs: [],
            subtitleLanguages: ['ENG'],
            subtitleCodecs: [],
        });
        constructLiveUrl.mockReset();
        constructLiveUrl.mockReturnValue('http://localhost/live/1.ts');
        constructVodUrl.mockReset();
        constructVodUrl.mockReturnValue('http://localhost/movie/1.mkv');
        constructEpisodeUrl.mockReset();
        constructEpisodeUrl.mockReturnValue('http://localhost/series/1.mp4');
        getSeriesInfo.mockReset();
        getSeriesInfo.mockResolvedValue({
            episodes: {},
            seasons: [],
            info: {},
        });
        setXtreamContentMediaMetadata.mockReset();
        setXtreamContentMediaMetadata.mockResolvedValue(true);

        TestBed.configureTestingModule({
            providers: [
                XtreamCatalogFacadeService,
                {
                    provide: XtreamStore,
                    useValue: xtreamStore,
                },
                {
                    provide: MediaMetadataService,
                    useValue: {
                        probe: mediaMetadataProbe,
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: {
                        setXtreamContentMediaMetadata,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        backgroundMetadataWarmup,
                        backgroundMetadataWarmupSchedule,
                        backgroundMetadataWarmupConcurrency,
                    },
                },
                {
                    provide: XtreamUrlService,
                    useValue: {
                        constructLiveUrl,
                        constructVodUrl,
                        constructEpisodeUrl,
                    },
                },
                {
                    provide: XtreamApiService,
                    useValue: {
                        getSeriesInfo,
                    },
                },
            ],
        });

        service = TestBed.inject(XtreamCatalogFacadeService);
    });

    it('delegates category search to the Xtream store', () => {
        service.setSearchQuery('matrix');

        expect(xtreamStore.setCategorySearchTerm).toHaveBeenCalledWith(
            'matrix'
        );
    });

    it('exposes store-driven paginated content, total pages, and category counts', () => {
        expect(service.paginatedContent()).toEqual([
            { xtream_id: 1, title: 'A' },
        ]);
        expect(service.totalPages()).toBe(1);
        expect(service.categoryItemCount()).toBe(2);

        paginatedContent.set([
            { xtream_id: 3, title: 'C' },
            { xtream_id: 4, title: 'D' },
        ]);
        selectedCategoryItems.set([
            { xtream_id: 3, title: 'C' },
            { xtream_id: 4, title: 'D' },
            { xtream_id: 5, title: 'E' },
        ]);
        totalPages.set(4);

        expect(service.paginatedContent()).toEqual([
            { xtream_id: 3, title: 'C' },
            { xtream_id: 4, title: 'D' },
        ]);
        expect(service.totalPages()).toBe(4);
        expect(service.categoryItemCount()).toBe(3);
    });

    it('restores saved sort mode, sets the selected category, and loads positions once per playlist', () => {
        localStorage.setItem('xtream-category-sort-mode', 'rating-desc');

        service.initialize('42');
        service.initialize('77');

        expect(xtreamStore.setContentSortMode).toHaveBeenCalledWith(
            'rating-desc'
        );
        expect(xtreamStore.setSelectedCategory).toHaveBeenLastCalledWith(77);
        expect(xtreamStore.loadAllPositions).toHaveBeenCalledTimes(1);
        expect(xtreamStore.loadAllPositions).toHaveBeenCalledWith('playlist-1');

        currentPlaylist.set(PLAYLIST_TWO);
        service.initialize('88');

        expect(xtreamStore.loadAllPositions).toHaveBeenCalledTimes(2);
        expect(xtreamStore.loadAllPositions).toHaveBeenLastCalledWith(
            'playlist-2'
        );
    });

    it('persists sort mode changes and delegates them to the store', () => {
        service.setContentSortMode('name-desc');

        expect(xtreamStore.setContentSortMode).toHaveBeenCalledWith(
            'name-desc'
        );
        expect(localStorage.getItem('xtream-category-sort-mode')).toBe(
            'name-desc'
        );
    });

    it('exposes and delegates the video quality filter', () => {
        expect(service.videoQualityFilter()).toBe('all');
        expect(service.videoQualityFilterOptions()).toEqual([
            { value: '2160p', label: '2160p+', count: 2 },
        ]);
        expect(service.videoQualityFilterActive()).toBe(false);

        service.setVideoQualityFilter('2160p');
        service.resetVideoQualityFilter();

        expect(xtreamStore.setVideoQualityFilter).toHaveBeenCalledWith('2160p');
        expect(xtreamStore.resetVideoQualityFilter).toHaveBeenCalled();
    });

    it('warms media metadata for visible VOD items and stores the probe result', async () => {
        service.warmVisibleMediaMetadata([
            {
                xtream_id: 44,
                title: 'Movie without metadata',
                container_extension: 'mkv',
            },
        ]);
        await Promise.resolve();
        await Promise.resolve();

        expect(constructVodUrl).toHaveBeenCalled();
        expect(mediaMetadataProbe).toHaveBeenCalledWith({
            url: 'http://localhost/movie/1.mkv',
            headers: {},
        });
        expect(xtreamStore.setContentMediaMetadata).toHaveBeenCalledWith(
            expect.objectContaining({
                contentType: 'vod',
                xtreamId: 44,
                metadataUpdatedAt: expect.any(Number),
                metadata: expect.objectContaining({
                    qualityLabel: '2160p HEVC',
                    audioLanguages: ['ITA'],
                    subtitleLanguages: ['ENG'],
                }),
            })
        );
        expect(setXtreamContentMediaMetadata).toHaveBeenCalledWith(
            'playlist-1',
            'movie',
            44,
            expect.objectContaining({
                qualityLabel: '2160p HEVC',
                audioLanguages: ['ITA'],
                subtitleLanguages: ['ENG'],
            })
        );
    });

    it('does not rewrite existing complete metadata during visible warmup', () => {
        service.warmVisibleMediaMetadata([
            {
                xtream_id: 44,
                title: 'Movie with complete metadata',
                mediaMetadata: {
                    available: true,
                    qualityLabel: '2160p HEVC',
                    height: 2160,
                    videoCodecs: ['HEVC'],
                    audioLanguages: ['ITA'],
                    audioCodecs: [],
                    subtitleLanguages: ['ENG'],
                    subtitleCodecs: [],
                },
            },
        ]);

        expect(mediaMetadataProbe).not.toHaveBeenCalled();
        expect(xtreamStore.setContentMediaMetadata).not.toHaveBeenCalled();
    });

    it('does not rediscover fresh partial series metadata on each startup', async () => {
        jest.useFakeTimers();
        const originalElectron = window.electron;
        const startMediaMetadataBackgroundWarmup = jest
            .fn()
            .mockResolvedValue({ running: false, pendingItems: 0 });
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                getMediaMetadataBackgroundStatus: jest
                    .fn()
                    .mockResolvedValue({ running: false, pendingItems: 0 }),
                startMediaMetadataBackgroundWarmup,
            },
        });

        try {
            serialStreams.set([
                {
                    series_id: 55,
                    title: 'Series with no subtitles',
                    mediaMetadata: {
                        available: true,
                        qualityLabel: '1080p H.264',
                        audioLanguages: ['ITA'],
                        audioCodecs: [],
                        subtitleLanguages: [],
                        subtitleCodecs: [],
                    },
                    mediaMetadataUpdatedAt: Date.now(),
                },
            ]);
            backgroundMetadataWarmup.set(true);
            TestBed.flushEffects();

            jest.advanceTimersByTime(5000);
            await Promise.resolve();
            await Promise.resolve();

            expect(startMediaMetadataBackgroundWarmup).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(window, 'electron', {
                configurable: true,
                value: originalElectron,
            });
            jest.useRealTimers();
        }
    });

    it('queues live, movie and series metadata with the source VPN context', async () => {
        const originalElectron = window.electron;
        const startMediaMetadataBackgroundWarmup = jest
            .fn()
            .mockResolvedValue({ running: false, pendingItems: 0 });
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                getMediaMetadataBackgroundStatus: jest
                    .fn()
                    .mockResolvedValue({ running: false, pendingItems: 0 }),
                startMediaMetadataBackgroundWarmup,
            },
        });

        try {
            currentPlaylist.set({
                ...PLAYLIST_ONE,
                vpnProvider: 'proton',
                vpnLocation: 'HR',
            });
            liveStreams.set([
                {
                    stream_id: 33,
                    title: 'Live channel without metadata',
                },
            ]);
            vodStreams.set([
                {
                    stream_id: 44,
                    title: 'Movie without metadata',
                    container_extension: 'mkv',
                },
            ]);
            serialStreams.set([
                {
                    series_id: 55,
                    title: 'Series without metadata',
                },
            ]);
            backgroundMetadataWarmup.set(true);

            await (service as unknown as {
                startBackgroundMetadataWarmup: () => Promise<void>;
            }).startBackgroundMetadataWarmup();
            await Promise.resolve();
            await Promise.resolve();

            expect(startMediaMetadataBackgroundWarmup).toHaveBeenCalledTimes(2);
            expect(startMediaMetadataBackgroundWarmup).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    jobs: expect.arrayContaining([
                        expect.objectContaining({
                            playlistId: 'playlist-1',
                            contentType: 'live',
                            sourceVpn: expect.objectContaining({
                                provider: 'proton',
                                location: 'HR',
                                sourceId: 'playlist-1',
                                sourceTitle: 'Playlist One',
                            }),
                        }),
                        expect.objectContaining({
                            playlistId: 'playlist-1',
                            contentType: 'movie',
                            sourceVpn: expect.objectContaining({
                                provider: 'proton',
                                location: 'HR',
                                sourceId: 'playlist-1',
                                sourceTitle: 'Playlist One',
                            }),
                        }),
                    ]),
                    runAfterWindowClose: true,
                })
            );
            expect(startMediaMetadataBackgroundWarmup).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    jobs: [],
                    seriesDiscoveryJobs: [
                        expect.objectContaining({
                            playlistId: 'playlist-1',
                            seriesXtreamId: 55,
                            sourceVpn: expect.objectContaining({
                                provider: 'proton',
                                location: 'HR',
                                sourceId: 'playlist-1',
                                sourceTitle: 'Playlist One',
                            }),
                        }),
                    ],
                    runAfterWindowClose: true,
                })
            );
        } finally {
            Object.defineProperty(window, 'electron', {
                configurable: true,
                value: originalElectron,
            });
        }
    });
});
