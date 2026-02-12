import { computed } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { ContentType } from '../../xtream-state';

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
            const getItemDate = (item: any, categoryType: ContentType): number => {
                const value =
                    categoryType === 'series'
                        ? item.last_modified ?? item.added
                        : item.added;
                return parseInt(value ?? '', 10) || 0;
            };

            const sortByMode = (
                items: any[],
                sortMode: XtreamCategorySortMode,
                categoryType: ContentType
            ): any[] => {
                const collator = new Intl.Collator(undefined, {
                    numeric: true,
                    sensitivity: 'base',
                });

                return [...items].sort((a: any, b: any) => {
                    if (sortMode === 'date-desc') {
                        return getItemDate(b, categoryType) - getItemDate(a, categoryType);
                    }
                    if (sortMode === 'date-asc') {
                        return getItemDate(a, categoryType) - getItemDate(b, categoryType);
                    }

                    const titleA = a.title ?? a.name ?? '';
                    const titleB = b.title ?? b.name ?? '';
                    const byName = collator.compare(titleA, titleB);
                    return sortMode === 'name-asc' ? byName : -byName;
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
                 * Get paginated content for the selected category
                 */
                getPaginatedContent: computed(() => {
                    const startIndex = store.page() * store.limit();
                    const endIndex = startIndex + store.limit();
                    const categoryId = store.selectedCategoryId();
                    const categoryType = store.selectedContentType();
                    const sortMode = store.contentSortMode();

                    // Access parent store content (from withContent)
                    const storeAny = store as any;
                    const content =
                        categoryType === 'live'
                            ? storeAny.liveStreams?.() || []
                            : categoryType === 'vod'
                              ? storeAny.vodStreams?.() || []
                              : storeAny.serialStreams?.() || [];

                    let filteredContent = content;
                    if (categoryId) {
                        filteredContent = content.filter(
                            (item: any) =>
                                Number(item.category_id) === categoryId
                        );
                        if (categoryType === 'vod' || categoryType === 'series') {
                            filteredContent = sortByMode(
                                filteredContent,
                                sortMode,
                                categoryType
                            );
                        }
                    } else {
                        filteredContent = sortedContent();
                    }

                    return filteredContent.slice(startIndex, endIndex);
                }),

                /**
                 * Get all items from the selected category (without pagination)
                 */
                selectItemsFromSelectedCategory: computed(() => {
                    const categoryId = store.selectedCategoryId();
                    const categoryType = store.selectedContentType();
                    const sortMode = store.contentSortMode();

                    // Access parent store content (from withContent)
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

                    const filteredContent = content.filter(
                        (item: any) => Number(item.category_id) === categoryId
                    );
                    if (categoryType === 'vod' || categoryType === 'series') {
                        return sortByMode(
                            filteredContent,
                            sortMode,
                            categoryType
                        );
                    }

                    return filteredContent;
                }),

                /**
                 * Get total pages for the selected category
                 */
                getTotalPages: computed(() => {
                    const categoryId = store.selectedCategoryId();
                    const categoryType = store.selectedContentType();

                    // Access parent store content (from withContent)
                    const storeAny = store as any;
                    const content =
                        categoryType === 'live'
                            ? storeAny.liveStreams?.() || []
                            : categoryType === 'vod'
                              ? storeAny.vodStreams?.() || []
                              : storeAny.serialStreams?.() || [];

                    let totalItems = 0;
                    if (categoryId) {
                        totalItems = content.filter(
                            (item: any) =>
                                Number(item.category_id) === categoryId
                        ).length;
                    } else {
                        totalItems = content.length;
                    }

                    return Math.ceil(totalItems / store.limit());
                }),

                /**
                 * Check if paginated content is loading
                 */
                isPaginatedContentLoading: computed(() => {
                    // Access parent store loading state (from withContent)
                    const storeAny = store as any;
                    return storeAny.isLoadingContent?.() || false;
                }),

                /**
                 * Memoized category item counts map
                 */
                getCategoryItemCounts: computed(() => {
                    const type = store.selectedContentType();

                    // Access parent store content (from withContent)
                    const storeAny = store as any;
                    const streams =
                        type === 'live'
                            ? storeAny.liveStreams?.() || []
                            : type === 'vod'
                              ? storeAny.vodStreams?.() || []
                              : storeAny.serialStreams?.() || [];

                    const countMap = new Map<number, number>();
                    for (const item of streams) {
                        const catId = Number(item.category_id);
                        if (!isNaN(catId)) {
                            countMap.set(catId, (countMap.get(catId) || 0) + 1);
                        }
                    }
                    return countMap;
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
