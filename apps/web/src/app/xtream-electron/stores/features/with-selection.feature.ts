import { computed } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { ContentType } from '../../xtream-state';

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
    selectedItem: any | null;
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
                item: any,
                categoryType: ContentType
            ): number => {
                const value =
                    categoryType === 'series'
                        ? (item.last_modified ?? item.added)
                        : item.added;
                return parseInt(value ?? '', 10) || 0;
            };

            const sortByMode = (
                items: any[],
                sortMode: XtreamCategorySortMode,
                categoryType: ContentType
            ): any[] => {
                return [...items].sort((a: any, b: any) => {
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
                items: any[],
                searchTerm: string
            ): any[] => {
                const normalized = searchTerm.trim().toLocaleLowerCase();
                if (!normalized) {
                    return items;
                }

                return items.filter((item: any) => {
                    const title = (item.title ?? item.name ?? '').toString();
                    return title.toLocaleLowerCase().includes(normalized);
                });
            };

            // Memoized sorted content - only recalculates when content/type changes
            const sortedContent = computed(() => {
                const categoryType = store.selectedContentType();
                const storeAny = store as any;
                const content =
                    categoryType === 'live'
                        ? storeAny.liveStreams?.() || []
                        : categoryType === 'vod'
                          ? storeAny.vodStreams?.() || []
                          : storeAny.serialStreams?.() || [];

                return sortByMode(content, 'date-desc', categoryType);
            });

            // ---------------------------------------------------------------------------
            // Per-type category item-count maps.
            // Each computed only recomputes when ITS streams array changes —
            // switching content tabs no longer triggers an O(n) full scan.
            // ---------------------------------------------------------------------------
            const buildCountMap = (streams: any[]): Map<number, number> => {
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
                buildCountMap((store as any).liveStreams?.() || [])
            );
            const vodItemCounts = computed(() =>
                buildCountMap((store as any).vodStreams?.() || [])
            );
            const seriesItemCounts = computed(() =>
                buildCountMap((store as any).serialStreams?.() || [])
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

                const storeAny = store as any;
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
                    (item: any) => Number(item.category_id) === categoryId
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
                    const storeAny = store as any;
                    const allCategories = [
                        ...(storeAny.vodCategories?.() || []),
                        ...(storeAny.liveCategories?.() || []),
                        ...(storeAny.serialCategories?.() || []),
                    ];

                    return allCategories.find(
                        (c: any) =>
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
                    const storeAny = store as any;
                    const content =
                        categoryType === 'live'
                            ? storeAny.liveStreams?.() || []
                            : categoryType === 'vod'
                              ? storeAny.vodStreams?.() || []
                              : storeAny.serialStreams?.() || [];

                    return content.find(
                        (item: any) =>
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
                isPaginatedContentLoading: computed(() => {
                    // Access parent store loading state (from withContent)
                    const storeAny = store as any;
                    return storeAny.isLoadingContent?.() || false;
                }),

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
                    const storeAny = store as any;
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
            setSelectedItem(item: any): void {
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
