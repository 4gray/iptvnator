import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    PortalCatalogSortMode,
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
    const currentPlaylist = signal<XtreamPlaylistData | null>(PLAYLIST_ONE);

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
        currentPlaylist,
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
        currentPlaylist.set(PLAYLIST_ONE);

        xtreamStore.loadAllPositions.mockClear();
        xtreamStore.setCategorySearchTerm.mockClear();
        xtreamStore.setSelectedItem.mockClear();
        xtreamStore.setSelectedCategory.mockClear();
        xtreamStore.setPage.mockClear();
        xtreamStore.setLimit.mockClear();
        xtreamStore.setContentSortMode.mockClear();
        xtreamStore.hasSeriesProgress.mockClear();
        xtreamStore.getProgressPercent.mockClear();
        xtreamStore.isWatched.mockClear();

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
        localStorage.setItem('xtream-category-sort-mode', 'name-asc');

        service.initialize('42');
        service.initialize('77');

        expect(xtreamStore.setContentSortMode).toHaveBeenCalledWith('name-asc');
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
});
