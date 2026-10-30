import { Provider, Injectable, computed, inject } from '@angular/core';
import {
    PortalCatalogFacade,
    PortalCatalogItemProgress,
    PortalCatalogPlaylistMeta,
    PortalCatalogSortMode,
    PortalWatchStateFilter,
    PORTAL_CATALOG_FACADE,
    resolvePortalSeriesWatchState,
    watchStateFromProgressPercent,
} from '@iptvnator/portal/shared/util';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';

const SORT_STORAGE_KEY = 'xtream-category-sort-mode';

const isValidSortMode = (mode: string | null): mode is PortalCatalogSortMode =>
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
    private readonly logger = createLogger('XtreamCatalogFacade');

    readonly provider = 'xtream' as const;
    readonly contentType = this.xtreamStore.selectedContentType;
    readonly selectedCategory = this.xtreamStore.getSelectedCategory;
    readonly paginatedContent = this.xtreamStore.getPaginatedContent;
    readonly selectedItem = this.xtreamStore.selectedItem;
    readonly hasMore = this.xtreamStore.hasMoreContent;
    /** Appends are synchronous in-memory slices — never pending, never failing. */
    readonly isAppending = computed(() => false);
    readonly appendError = computed(() => false);
    readonly isPaginatedContentLoading =
        this.xtreamStore.isPaginatedContentLoading;
    readonly selectedCategoryTitle = computed(() => {
        if (!this.xtreamStore.selectedCategoryId()) {
            return null;
        }
        const category = this.selectedCategory();
        return String(
            category?.['name'] ??
                category?.['title'] ??
                category?.['category_name'] ??
                ''
        );
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
    get supportsWatchStateFilter(): boolean {
        return this.contentType() === 'vod';
    }
    readonly watchStateFilter = computed<PortalWatchStateFilter>(() =>
        this.supportsWatchStateFilter
            ? this.xtreamStore.watchStateFilter()
            : null
    );
    readonly watchFilterLoadState = computed(() => {
        if (
            !this.supportsWatchStateFilter ||
            !this.xtreamStore.currentPlaylist()?.id ||
            this.xtreamStore.positionsPlaylistId() !==
                this.xtreamStore.currentPlaylist()?.id
        )
            return 'idle';
        return this.xtreamStore.positionsLoadState();
    });

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

        // Every genuine catalog entry (including Back from inline playback)
        // refreshes persisted progress. Filtering and append remain memory-only.
        this.refreshPositions();

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

    loadMore(): void {
        this.xtreamStore.loadMoreContent();
    }

    retryAppend(): void {
        // In-memory appends cannot fail; nothing to retry.
    }

    saveScrollPosition(scrollTop: number): void {
        this.xtreamStore.saveCatalogScrollState(scrollTop);
    }

    consumeSavedScrollPosition(): number | null {
        return this.xtreamStore.consumeCatalogScrollState();
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

    setWatchStateFilter(value: PortalWatchStateFilter): void {
        if (this.supportsWatchStateFilter)
            this.xtreamStore.setWatchStateFilter(value);
    }

    retryWatchFilterPositions(): void {
        if (this.supportsWatchStateFilter) this.refreshPositions();
    }

    private refreshPositions(): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return;
        void this.xtreamStore.loadAllPositions(playlistId).catch((error) => {
            this.logger.warn(
                'Failed to load catalog playback positions',
                error
            );
        });
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
                watchState: resolvePortalSeriesWatchState(
                    this.xtreamStore.hasSeriesProgress(itemId)
                ),
            };
        }

        const progress = this.xtreamStore.getProgressPercent(itemId, 'vod');
        return {
            progress,
            watchState: watchStateFromProgressPercent(progress),
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
