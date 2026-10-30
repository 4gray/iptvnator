import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    PortalCatalogSortMode,
    PortalWatchStateFilter,
} from '@iptvnator/portal/shared/util';
import {
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
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
    const hasMoreContent = signal(false);
    const isPaginatedContentLoading = signal(false);
    const contentSortMode = signal<PortalCatalogSortMode>('date-desc');
    const minRating = signal<number | null>(null);
    const watchStateFilter = signal<PortalWatchStateFilter>(null);
    const positionsLoadState = signal<'idle' | 'loading' | 'ready' | 'error'>(
        'idle'
    );
    const positionsPlaylistId = signal<string | null>(null);
    const currentPlaylist = signal<XtreamPlaylistData | null>(PLAYLIST_ONE);

    const xtreamStore = {
        selectedContentType: contentType,
        getSelectedCategory: selectedCategory,
        selectedCategoryId,
        getPaginatedContent: paginatedContent,
        selectItemsFromSelectedCategory: selectedCategoryItems,
        selectedItem,
        hasMoreContent,
        isPaginatedContentLoading,
        contentSortMode,
        minRating,
        currentPlaylist,
        watchStateFilter,
        positionsLoadState,
        positionsPlaylistId,
        setWatchStateFilter: jest.fn((value: PortalWatchStateFilter) =>
            watchStateFilter.set(value)
        ),
        loadAllPositions: jest.fn().mockResolvedValue(undefined),
        setCategorySearchTerm: jest.fn(),
        setSelectedItem: jest.fn((item: Record<string, unknown> | null) => {
            selectedItem.set(item);
        }),
        setSelectedCategory: jest.fn((categoryId: number | null) => {
            selectedCategoryId.set(categoryId);
        }),
        loadMoreContent: jest.fn(),
        saveCatalogScrollState: jest.fn(),
        consumeCatalogScrollState: jest.fn().mockReturnValue(null),
        setContentSortMode: jest.fn((mode: PortalCatalogSortMode) => {
            contentSortMode.set(mode);
        }),
        setMinRating: jest.fn((value: number | null) => {
            minRating.set(value);
        }),
        hasSeriesProgress: jest.fn().mockReturnValue(false),
        getProgressPercent: jest.fn().mockReturnValue(40),
    };

    beforeEach(() => {
        localStorage.removeItem('xtream-category-sort-mode');
        contentType.set('vod');
        watchStateFilter.set(null);
        positionsLoadState.set('idle');
        positionsPlaylistId.set(null);
        xtreamStore.setWatchStateFilter.mockClear();
        selectedCategory.set({ id: 11, name: 'Movies' });
        selectedCategoryId.set(11);
        paginatedContent.set([{ xtream_id: 1, title: 'A' }]);
        selectedCategoryItems.set([
            { xtream_id: 1, title: 'A' },
            { xtream_id: 2, title: 'B' },
        ]);
        selectedItem.set(null);
        hasMoreContent.set(false);
        isPaginatedContentLoading.set(false);
        contentSortMode.set('date-desc');
        minRating.set(null);
        currentPlaylist.set(PLAYLIST_ONE);

        xtreamStore.loadAllPositions.mockClear();
        xtreamStore.setCategorySearchTerm.mockClear();
        xtreamStore.setSelectedItem.mockClear();
        xtreamStore.setSelectedCategory.mockClear();
        xtreamStore.loadMoreContent.mockClear();
        xtreamStore.saveCatalogScrollState.mockClear();
        xtreamStore.consumeCatalogScrollState.mockClear();
        xtreamStore.setContentSortMode.mockClear();
        xtreamStore.setMinRating.mockClear();
        xtreamStore.hasSeriesProgress.mockClear();
        xtreamStore.getProgressPercent.mockClear();

        TestBed.configureTestingModule({
            providers: [
                XtreamCatalogFacadeService,
                {
                    provide: XtreamStore,
                    useValue: xtreamStore,
                },
            ],
        });

        service = TestBed.inject(XtreamCatalogFacadeService);
    });

    it('titles a selected category and leaves the every-item title to the view', () => {
        expect(service.selectedCategoryTitle()).toBe('Movies');

        selectedCategoryId.set(null);
        selectedCategory.set({ id: 0, name: '' });

        expect(service.selectedCategoryTitle()).toBeNull();
    });

    it('delegates category search to the Xtream store', () => {
        service.setSearchQuery('matrix');

        expect(xtreamStore.setCategorySearchTerm).toHaveBeenCalledWith(
            'matrix'
        );
    });

    it('exposes store-driven windowed content, hasMore, and category counts', () => {
        expect(service.paginatedContent()).toEqual([
            { xtream_id: 1, title: 'A' },
        ]);
        expect(service.hasMore()).toBe(false);
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
        hasMoreContent.set(true);

        expect(service.paginatedContent()).toEqual([
            { xtream_id: 3, title: 'C' },
            { xtream_id: 4, title: 'D' },
        ]);
        expect(service.hasMore()).toBe(true);
        expect(service.categoryItemCount()).toBe(3);
    });

    it('delegates loadMore and the scroll-position handoff to the store', () => {
        service.loadMore();
        expect(xtreamStore.loadMoreContent).toHaveBeenCalledTimes(1);

        service.saveScrollPosition(420);
        expect(xtreamStore.saveCatalogScrollState).toHaveBeenCalledWith(420);

        xtreamStore.consumeCatalogScrollState.mockReturnValueOnce(420);
        expect(service.consumeSavedScrollPosition()).toBe(420);
        expect(service.consumeSavedScrollPosition()).toBeNull();

        // Synchronous in-memory appends never surface async tail states.
        expect(service.isAppending()).toBe(false);
        expect(service.appendError()).toBe(false);
    });

    it('restores saved sort mode, sets the selected category, and refreshes positions on each catalog entry', () => {
        localStorage.setItem('xtream-category-sort-mode', 'name-asc');

        service.initialize('42');
        service.initialize('77');

        expect(xtreamStore.setContentSortMode).toHaveBeenCalledWith('name-asc');
        expect(xtreamStore.setSelectedCategory).toHaveBeenLastCalledWith(77);
        expect(xtreamStore.loadAllPositions).toHaveBeenCalledTimes(2);
        expect(xtreamStore.loadAllPositions).toHaveBeenCalledWith('playlist-1');

        currentPlaylist.set(PLAYLIST_TWO);
        service.initialize('88');

        expect(xtreamStore.loadAllPositions).toHaveBeenCalledTimes(3);
        expect(xtreamStore.loadAllPositions).toHaveBeenLastCalledWith(
            'playlist-2'
        );
    });

    it('exposes Movies-only capability and normalizes its filter and readiness by source', () => {
        expect(service.supportsWatchStateFilter).toBe(true);
        service.setWatchStateFilter('watched');
        expect(service.watchStateFilter()).toBe('watched');
        positionsPlaylistId.set('playlist-1');
        positionsLoadState.set('ready');
        expect(service.watchFilterLoadState()).toBe('ready');
        currentPlaylist.set(PLAYLIST_TWO);
        expect(service.watchFilterLoadState()).toBe('idle');
        positionsPlaylistId.set('playlist-2');
        positionsLoadState.set('error');
        expect(service.watchFilterLoadState()).toBe('error');
        contentType.set('series');
        expect(service.supportsWatchStateFilter).toBe(false);
        expect(service.watchStateFilter()).toBeNull();
        expect(service.watchFilterLoadState()).toBe('idle');
        service.setWatchStateFilter('unwatched');
        expect(xtreamStore.setWatchStateFilter).toHaveBeenCalledTimes(1);
        contentType.set('live');
        expect(service.supportsWatchStateFilter).toBe(false);
    });

    it('retries only the current source and handles rejected position reads', async () => {
        xtreamStore.loadAllPositions.mockRejectedValueOnce(
            new Error('read failed')
        );
        service.retryWatchFilterPositions();
        await Promise.resolve();
        await Promise.resolve();
        expect(xtreamStore.loadAllPositions).toHaveBeenCalledWith('playlist-1');
        currentPlaylist.set(PLAYLIST_TWO);
        service.retryWatchFilterPositions();
        expect(xtreamStore.loadAllPositions).toHaveBeenLastCalledWith(
            'playlist-2'
        );
        xtreamStore.loadAllPositions.mockClear();
        service.setWatchStateFilter('watched');
        service.setContentSortMode('name-asc');
        service.loadMore();
        expect(xtreamStore.loadAllPositions).not.toHaveBeenCalled();
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

    it('keeps rating sort modes out of live content', () => {
        contentSortMode.set('rating-desc');
        contentType.set('live');

        expect(service.supportsRatingSort).toBe(false);
        expect(service.contentSortMode()).toBe('date-desc');

        service.setContentSortMode('rating-asc');

        expect(xtreamStore.setContentSortMode).not.toHaveBeenCalled();
        expect(localStorage.getItem('xtream-category-sort-mode')).toBeNull();

        contentType.set('vod');

        expect(service.supportsRatingSort).toBe(true);
        expect(service.contentSortMode()).toBe('rating-desc');

        service.setContentSortMode('rating-asc');

        expect(xtreamStore.setContentSortMode).toHaveBeenCalledWith(
            'rating-asc'
        );
        expect(localStorage.getItem('xtream-category-sort-mode')).toBe(
            'rating-asc'
        );
    });

    it('does not restore saved rating sort modes for live content', () => {
        contentType.set('live');
        localStorage.setItem('xtream-category-sort-mode', 'rating-desc');

        service.initialize('42');

        expect(xtreamStore.setContentSortMode).not.toHaveBeenCalled();
        expect(service.contentSortMode()).toBe('date-desc');
    });

    it('exposes rating refinements only for VOD and series content', () => {
        minRating.set(8);

        expect(service.supportsRatingSort).toBe(true);
        expect(service.minRating?.()).toBe(8);

        service.setMinRating(7);

        expect(xtreamStore.setMinRating).toHaveBeenCalledWith(7);

        contentType.set('series');

        expect(service.supportsRatingSort).toBe(true);
        expect(service.minRating?.()).toBe(7);

        xtreamStore.setMinRating.mockClear();
        contentType.set('live');

        expect(service.supportsRatingSort).toBe(false);
        expect(service.minRating?.()).toBeNull();

        service.setMinRating(9);

        expect(xtreamStore.setMinRating).not.toHaveBeenCalled();
    });

    it('maps movie progress and series episode rows onto one watch state', () => {
        xtreamStore.getProgressPercent.mockReturnValue(40);
        expect(service.getItemProgress({ xtream_id: 1 })).toEqual({
            progress: 40,
            watchState: 'in-progress',
        });

        xtreamStore.getProgressPercent.mockReturnValue(95);
        expect(service.getItemProgress({ xtream_id: 1 })).toEqual({
            progress: 95,
            watchState: 'watched',
        });

        xtreamStore.getProgressPercent.mockReturnValue(0);
        expect(service.getItemProgress({ xtream_id: 1 })).toEqual({
            progress: 0,
            watchState: 'unwatched',
        });

        // A series card only knows that some episode was started; the
        // catalog list cannot tell whether every episode is done.
        contentType.set('series');
        xtreamStore.hasSeriesProgress.mockReturnValue(true);
        expect(service.getItemProgress({ series_id: 7 })).toEqual({
            watchState: 'in-progress',
        });
        xtreamStore.hasSeriesProgress.mockReturnValue(false);
        expect(service.getItemProgress({ series_id: 7 })).toEqual({
            watchState: 'unwatched',
        });
    });
});
