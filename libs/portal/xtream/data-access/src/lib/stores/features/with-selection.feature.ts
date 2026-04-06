import { computed } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { ContentType, XtreamContentLoadState } from '../../xtream-state';

/**
 * Module-level collator — allocating Intl.Collator is expensive;
 * one shared instance avoids repeated allocation on every sort call.
 */
const COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export type XtreamCategorySortMode =
    | 'date-desc'
    | 'date-asc'
    | 'name-asc'
    | 'name-desc';

/**
 * Selection state for managing UI selection and pagination
 */
export interface SelectionState {
    selectedContentType: ContentType;
    selectedCategoryId: number | null;
    selectedItem: XtreamSelectionItem | null;
    page: number;
    limit: number;
    contentSortMode: XtreamCategorySortMode;
    categorySearchTerm: string;
    isLoadingDetails: boolean;
    detailsError: string | null;
}

/**
 * Initial selection state
 */
const initialSelectionState: SelectionState = {
    selectedContentType: 'vod',
    selectedCategoryId: null,
    selectedItem: null,
    page: 0,
    limit: Number(localStorage.getItem('xtream-page-size') ?? 25),
    contentSortMode: 'date-desc',
    categorySearchTerm: '',
    isLoadingDetails: false,
    detailsError: null,
};

interface XtreamSelectionCategory {
    readonly [key: string]: unknown;
    readonly category_name?: string;
    readonly category_id?: string | number;
    readonly id?: string | number;
    readonly name?: string;
    readonly type?: ContentType;
}

interface XtreamSelectionItem {
    readonly [key: string]: unknown;
    readonly added?: string;
    readonly category_id?: string | number;
    readonly episodes?: unknown;
    readonly id?: string | number;
    readonly info?: {
        readonly actors?: string;
        readonly backdrop_path?: string[];
        readonly cast?: string;
        readonly country?: string;
        readonly cover?: string;
        readonly description?: string;
        readonly director?: string;
        readonly duration?: string;
        readonly episode_run_time?: number | string;
        readonly genre?: string;
        readonly movie_image?: string;
        readonly name?: string;
        readonly plot?: string;
        readonly rating?: number | string;
        readonly rating_imdb?: string;
        readonly rating_kinopoisk?: string;
        readonly releaseDate?: string;
        readonly releasedate?: string;
        readonly youtube_trailer?: string;
    };
    readonly last_modified?: string;
    readonly movie_data?: {
        readonly name?: string;
    };
    readonly name?: string;
    readonly series_id?: string | number;
    readonly stream_id?: string | number;
    readonly title?: string;
    readonly xtream_id?: number;
}

type ParentSelectionStoreLike = {
    contentLoadStateByType?: () => Record<ContentType, XtreamContentLoadState>;
    isLoadingContent?: () => boolean;
    liveCategories?: () => XtreamSelectionCategory[];
    liveStreams?: () => XtreamSelectionItem[];
    serialCategories?: () => XtreamSelectionCategory[];
    serialStreams?: () => XtreamSelectionItem[];
    vodCategories?: () => XtreamSelectionCategory[];
    vodStreams?: () => XtreamSelectionItem[];
};

/**
 * Selection feature store for managing UI selection and pagination.
 * Handles:
 * - Content type selection (live, vod, series)
 * - Category selection
 * - Item selection
 * - Pagination (page, limit)
 */
export function withSelection() {
    return signalStoreFeature(
        withState<SelectionState>(initialSelectionState),

        withComputed((store) => {
            const getItemDate = (
                item: XtreamSelectionItem,
                categoryType: ContentType
            ): number => {
                const value =
                    categoryType === 'series'
                        ? (item.last_modified ?? item.added)
                        : item.added;
                return parseInt(value ?? '', 10) || 0;
            };

            const sortByMode = (
                items: XtreamSelectionItem[],
                sortMode: XtreamCategorySortMode,
                categoryType: ContentType
            ): XtreamSelectionItem[] => {
                return [...items].sort((a, b) => {
                    if (sortMode === 'date-desc') {
                        return (
                            getItemDate(b, categoryType) -
                            getItemDate(a, categoryType)
                        );
                    }
                    if (sortMode === 'date-asc') {
                        return (
                            getItemDate(a, categoryType) -
                            getItemDate(b, categoryType)
                        );
                    }

                    const titleA = a.title ?? a.name ?? '';
                    const titleB = b.title ?? b.name ?? '';
                    const byName = COLLATOR.compare(titleA, titleB);
                    return sortMode === 'name-asc' ? byName : -byName;
                });
            };

            const filterBySearchTerm = (
                items: XtreamSelectionItem[],
                searchTerm: string
            ): XtreamSelectionItem[] => {
                const normalized = searchTerm.trim().toLocaleLowerCase();
                if (!normalized) {
                    return items;
                }

                return items.filter((item) => {
                    const title = (item.title ?? item.name ?? '').toString();
                    return title.toLocaleLowerCase().includes(normalized);
                });
            };

            // Memoized sorted content - only recalculates when content/type changes
            const sortedContent = computed(() => {
                const categoryType = store.selectedContentType();
                const sortMode = store.contentSortMode();
                const storeAny = store as ParentSelectionStoreLike;
                const content =
                    categoryType === 'live'
                        ? storeAny.liveStreams?.() || []
                        : categoryType === 'vod'
                          ? storeAny.vodStreams?.() || []
                          : storeAny.serialStreams?.() || [];

                if (categoryType === 'vod' || categoryType === 'series') {
                    return sortByMode(content, sortMode, categoryType);
                }

                return sortByMode(content, 'date-desc', categoryType);
            });

            // ---------------------------------------------------------------------------
            // Per-type category item-count maps.
            // Each computed only recomputes when ITS streams array changes —
            // switching content tabs no longer triggers an O(n) full scan.
            // ---------------------------------------------------------------------------
            const buildCountMap = (
                streams: XtreamSelectionItem[]
            ): Map<number, number> => {
                const countMap = new Map<number, number>();
                for (const item of streams) {
                    const catId = Number(item.category_id);
                    if (!isNaN(catId)) {
                        countMap.set(catId, (countMap.get(catId) || 0) + 1);
                    }
                }
                return countMap;
            };

            const liveItemCounts = computed(() =>
                buildCountMap(
                    (store as ParentSelectionStoreLike).liveStreams?.() || []
                )
            );
            const vodItemCounts = computed(() =>
                buildCountMap(
                    (store as ParentSelectionStoreLike).vodStreams?.() || []
                )
            );
            const seriesItemCounts = computed(() =>
                buildCountMap(
                    (store as ParentSelectionStoreLike).serialStreams?.() || []
                )
            );
            const selectedTypeContentState = computed(() => {
                const storeAny = store as ParentSelectionStoreLike;
                const selectedType = store.selectedContentType();
                return (
                    storeAny.contentLoadStateByType?.()?.[selectedType] ??
                    'idle'
                );
            });
            const selectedTypeContentLoading = computed(
                () => selectedTypeContentState() === 'loading'
            );
            const selectedTypeContentReady = computed(
                () => selectedTypeContentState() === 'ready'
            );
            const selectedTypeCountsReady = computed(
                () => selectedTypeContentReady()
            );

            // ---------------------------------------------------------------------------
            // Stable filter + sort intermediate.
            // Depends on category / search / sort — but NOT on page or limit.
            // This prevents re-sorting the full array on every page-navigation.
            // ---------------------------------------------------------------------------
            const filteredAndSortedContent = computed(() => {
                const categoryId = store.selectedCategoryId();
                const categoryType = store.selectedContentType();
                const sortMode = store.contentSortMode();
                const searchTerm = store.categorySearchTerm();

                const storeAny = store as ParentSelectionStoreLike;
                const content =
                    categoryType === 'live'
                        ? storeAny.liveStreams?.() || []
                        : categoryType === 'vod'
                          ? storeAny.vodStreams?.() || []
                          : storeAny.serialStreams?.() || [];

                if (!categoryId) {
                    return sortedContent();
                }

                let filtered = content.filter(
                    (item) => Number(item.category_id) === categoryId
                );
                if (categoryType === 'vod' || categoryType === 'series') {
                    filtered = filterBySearchTerm(filtered, searchTerm);
                    filtered = sortByMode(filtered, sortMode, categoryType);
                }
                return filtered;
            });

            return {
                /**
                 * Get the selected category from the parent store's categories
                 */
                getSelectedCategory: computed(() => {
                    const categoryId = store.selectedCategoryId();
                    if (!categoryId) {
                        return {
                            id: 0,
                            name: 'All Items',
                            type: store.selectedContentType(),
                        };
                    }

                    // Access parent store categories (from withContent)
                    const storeAny = store as ParentSelectionStoreLike;
                    const allCategories: XtreamSelectionCategory[] = [
                        ...(storeAny.vodCategories?.() || []),
                        ...(storeAny.liveCategories?.() || []),
                        ...(storeAny.serialCategories?.() || []),
                    ];

                    return allCategories.find(
                        (c) =>
                            c.id === categoryId ||
                            c.category_id === String(categoryId)
                    );
                }),

                /**
                 * Get the selected item by ID from content
                 */
                getSelectedItemById: computed(() => {
                    const categoryType = store.selectedContentType();
                    const selectedItem = store.selectedItem();

                    if (!selectedItem) return null;

                    // Access parent store content (from withContent)
                    const storeAny = store as ParentSelectionStoreLike;
                    const content =
                        categoryType === 'live'
                            ? storeAny.liveStreams?.() || []
                            : categoryType === 'vod'
                              ? storeAny.vodStreams?.() || []
                              : storeAny.serialStreams?.() || [];

                    return content.find(
                        (item) =>
                            item.stream_id === selectedItem.stream_id ||
                            item.id === selectedItem.id ||
                            item.series_id === selectedItem.series_id
                    );
                }),

                /**
                 * Get paginated content for the selected category.
                 * Slices from the stable `filteredAndSortedContent` intermediate so
                 * page navigation never triggers a full re-sort of the array.
                 */
                getPaginatedContent: computed(() => {
                    const start = store.page() * store.limit();
                    return filteredAndSortedContent().slice(
                        start,
                        start + store.limit()
                    );
                }),

                /**
                 * Get all items from the selected category (without pagination).
                 * Reuses the `filteredAndSortedContent` intermediate to avoid
                 * duplicating the filter+sort work already done for pagination.
                 */
                selectItemsFromSelectedCategory: computed(() =>
                    filteredAndSortedContent()
                ),

                /**
                 * Get total pages for the selected category.
                 * Derives length from the shared `filteredAndSortedContent` intermediate.
                 */
                getTotalPages: computed(() =>
                    Math.ceil(filteredAndSortedContent().length / store.limit())
                ),

                /**
                 * Check if paginated content is loading
                 */
                isPaginatedContentLoading: computed(() =>
                    selectedTypeContentLoading()
                ),

                selectedTypeContentState,

                selectedTypeContentLoading,

                selectedTypeContentReady,

                selectedTypeCountsReady,

                /**
                 * Memoized category item counts map.
                 * Selects from per-type pre-computed maps so switching content tabs
                 * is O(1) — no full array scan on every tab switch.
                 */
                getCategoryItemCounts: computed(() => {
                    const type = store.selectedContentType();
                    return type === 'live'
                        ? liveItemCounts()
                        : type === 'vod'
                          ? vodItemCounts()
                          : seriesItemCounts();
                }),

                /**
                 * Get categories for the currently selected content type
                 */
                getCategoriesBySelectedType: computed(() => {
                    const type = store.selectedContentType();

                    // Access parent store categories (from withContent)
                    const storeAny = store as ParentSelectionStoreLike;
                    return type === 'live'
                        ? storeAny.liveCategories?.() || []
                        : type === 'vod'
                          ? storeAny.vodCategories?.() || []
                          : storeAny.serialCategories?.() || [];
                }),
            };
        }),

        withMethods((store) => ({
            /**
             * Set the content type (live, vod, series)
             */
            setSelectedContentType(type: ContentType): void {
                if (store.selectedContentType() === type) {
                    return;
                }

                patchState(store, {
                    selectedContentType: type,
                    selectedCategoryId: null,
                    page: 0,
                    categorySearchTerm: '',
                });
            },

            /**
             * Set the selected category
             * Only resets page to 0 when category actually changes
             */
            setSelectedCategory(categoryId: number | null): void {
                const newCategoryId =
                    categoryId !== null ? Number(categoryId) : null;
                const currentCategoryId = store.selectedCategoryId();

                // Only reset page if category actually changed
                if (currentCategoryId !== newCategoryId) {
                    patchState(store, {
                        selectedCategoryId: newCategoryId,
                        page: 0,
                        categorySearchTerm: '',
                    });
                }
            },

            /**
             * Set the selected item
             */
            setSelectedItem(item: XtreamSelectionItem | null): void {
                patchState(store, { selectedItem: item });
            },

            /**
             * Set the loading details state
             */
            setIsLoadingDetails(isLoading: boolean): void {
                patchState(store, { isLoadingDetails: isLoading });
            },

            /**
             * Set the details error state
             */
            setDetailsError(error: string | null): void {
                patchState(store, { detailsError: error });
            },

            /**
             * Set the current page
             */
            setPage(page: number): void {
                patchState(store, { page });
            },

            /**
             * Set the page limit (items per page)
             */
            setLimit(limit: number): void {
                patchState(store, { limit });
                localStorage.setItem('xtream-page-size', String(limit));
            },

            /**
             * Set category content sort mode
             */
            setContentSortMode(mode: XtreamCategorySortMode): void {
                if (store.contentSortMode() === mode) {
                    return;
                }
                patchState(store, {
                    contentSortMode: mode,
                    page: 0,
                });
            },

            /**
             * Set selected category search term
             */
            setCategorySearchTerm(term: string): void {
                patchState(store, {
                    categorySearchTerm: term,
                    page: 0,
                });
            },

            /**
             * Reset selection state
             */
            resetSelection(): void {
                patchState(store, {
                    ...initialSelectionState,
                    limit: Number(
                        localStorage.getItem('xtream-page-size') ?? 25
                    ),
                });
            },
        }))
    );
}
