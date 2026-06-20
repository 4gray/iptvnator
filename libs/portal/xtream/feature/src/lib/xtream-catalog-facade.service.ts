import { Provider, Injectable, computed, inject } from '@angular/core';
import {
    PortalCatalogFacade,
    PortalCatalogItemProgress,
    PortalCatalogPlaylistMeta,
    PortalCatalogSortMode,
    PORTAL_CATALOG_FACADE,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';

const SORT_STORAGE_KEY = 'xtream-category-sort-mode';

const isValidSortMode = (
    mode: string | null
): mode is PortalCatalogSortMode =>
    mode === 'date-desc' ||
    mode === 'date-asc' ||
    mode === 'name-asc' ||
    mode === 'name-desc' ||
    mode === 'rating-desc' ||
    mode === 'rating-asc';

const isRatingSortMode = (mode: PortalCatalogSortMode): boolean =>
    mode === 'rating-desc' || mode === 'rating-asc';

@Injectable()
export class XtreamCatalogFacadeService implements PortalCatalogFacade<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
> {
    private readonly xtreamStore = inject(XtreamStore);
    private loadedPositionsPlaylistId: string | null = null;

    readonly provider = 'xtream' as const;
    readonly pageSizeOptions = [10, 25, 50, 100] as const;
    readonly contentType = this.xtreamStore.selectedContentType;
    readonly limit = this.xtreamStore.limit;
    readonly pageIndex = this.xtreamStore.page;
    readonly selectedCategory = this.xtreamStore.getSelectedCategory;
    readonly paginatedContent = this.xtreamStore.getPaginatedContent;
    readonly selectedItem = this.xtreamStore.selectedItem;
    readonly totalPages = this.xtreamStore.getTotalPages;
    readonly isPaginatedContentLoading =
        this.xtreamStore.isPaginatedContentLoading;
    readonly selectedCategoryTitle = computed(() => {
        const category = this.selectedCategory();
        return String(category?.['name'] ?? category?.['title'] ?? '');
    });
    readonly categoryItemCount = computed(
        () => this.xtreamStore.selectItemsFromSelectedCategory().length
    );
    readonly contentSortMode = computed<PortalCatalogSortMode>(() => {
        const mode = this.xtreamStore.contentSortMode();

        return !this.supportsRatingSort && isRatingSortMode(mode)
            ? 'date-desc'
            : mode;
    });
    get supportsRatingSort(): boolean {
        const type = this.contentType();
        return type === 'vod' || type === 'series';
    }
    readonly minRating = computed(() =>
        this.supportsRatingSort ? this.xtreamStore.minRating() : null
    );
    readonly playlist = computed<PortalCatalogPlaylistMeta | null>(() => {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return null;
        }

        return {
            id: String(playlist.id),
            title: playlist.name ?? playlist.title ?? 'Xtream',
        };
    });

    initialize(categoryId?: string | null): void {
        const savedSortMode = localStorage.getItem(SORT_STORAGE_KEY);
        if (isValidSortMode(savedSortMode)) {
            this.setContentSortMode(savedSortMode);
        }

        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (playlistId && this.loadedPositionsPlaylistId !== playlistId) {
            this.loadedPositionsPlaylistId = playlistId;
            this.xtreamStore.loadAllPositions(playlistId);
        }

        this.clearSelectedItem();

        if (categoryId) {
            this.xtreamStore.setSelectedCategory(Number(categoryId));
        } else {
            this.xtreamStore.setSelectedCategory(null);
        }
    }

    clearSelectedItem(): void {
        this.xtreamStore.setSelectedItem(null);
    }

    setSearchQuery(query: string): void {
        this.xtreamStore.setCategorySearchTerm(query);
    }

    setPage(page: number): void {
        this.xtreamStore.setPage(page);
    }

    setLimit(limit: number): void {
        this.xtreamStore.setLimit(limit);
    }

    setContentSortMode(mode: PortalCatalogSortMode): void {
        if (!this.supportsRatingSort && isRatingSortMode(mode)) {
            return;
        }

        this.xtreamStore.setContentSortMode(mode);
        localStorage.setItem(SORT_STORAGE_KEY, mode);
    }

    setMinRating(value: number | null): void {
        if (!this.supportsRatingSort) {
            return;
        }

        this.xtreamStore.setMinRating(value);
    }

    selectItem(item: Record<string, unknown>): string[] | null {
        const xtreamId = item['xtream_id'];
        if (xtreamId === undefined || xtreamId === null) {
            return null;
        }

        const selectedCategoryId = this.xtreamStore.selectedCategoryId();
        if (selectedCategoryId !== null && selectedCategoryId !== undefined) {
            return [String(xtreamId)];
        }

        const categoryId = item['category_id'];
        if (categoryId === undefined || categoryId === null) {
            return null;
        }

        return [String(categoryId), String(xtreamId)];
    }

    getItemProgress(item: Record<string, unknown>): PortalCatalogItemProgress {
        const isSeries = this.contentType() === 'series';
        const itemId = Number(
            item['xtream_id'] ?? item['series_id'] ?? item['stream_id']
        );
        if (Number.isNaN(itemId)) {
            return {};
        }

        if (isSeries) {
            return {
                hasSeriesProgress: this.xtreamStore.hasSeriesProgress(itemId),
            };
        }

        return {
            progress: this.xtreamStore.getProgressPercent(itemId, 'vod'),
            isWatched: this.xtreamStore.isWatched(itemId, 'vod'),
        };
    }
}

export function provideXtreamCatalogFacade(): Provider[] {
    return [
        XtreamCatalogFacadeService,
        {
            provide: PORTAL_CATALOG_FACADE,
            useExisting: XtreamCatalogFacadeService,
        },
    ];
}
