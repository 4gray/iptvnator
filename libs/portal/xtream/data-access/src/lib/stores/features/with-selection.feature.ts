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
    | 'name-desc'
    | 'rating-desc'
    | 'rating-asc';

/**
 * First render window of the infinite-scroll catalog grid. Growing the window
 * is a free in-memory slice, so the initial batch is a generous constant — the
 * shared scroll directive tops it up by measuring container overflow rather
 * than by computing card counts from the viewport.
 */
export const CATALOG_INITIAL_WINDOW = 50;

/** How many more items each `loadMoreContent()` reveals. */
export const CATALOG_WINDOW_CHUNK = 50;

/**
 * Grid scroll position captured when a list view goes away (detail opened,
 * tab switched), so returning to the same list restores both the render
 * window and the scroll offset. The selection coordinates identify the
 * snapshot: only an exact match may restore it.
 */
export interface CatalogScrollState {
    contentType: ContentType;
    categoryId: number | null;
    searchTerm: string;
    sortMode: XtreamCategorySortMode;
    minRating: number | null;
    visibleCount: number;
    scrollTop: number;
}

/**
 * Snapshots are kept per selection identity (one slot would let a tab detour
 * — VOD → Series → VOD — overwrite the first tab's spot with the second's on
 * destroy). Bounded so a long browsing session cannot accumulate one entry
 * per category visited.
 */
const MAX_SAVED_CATALOG_SCROLLS = 8;

/**
 * Selection state for managing UI selection and the infinite-scroll window
 */
export interface SelectionState {
    selectedContentType: ContentType;
    selectedCategoryId: number | null;
    selectedItem: XtreamSelectionItem | null;
    visibleCount: number;
    savedCatalogScrolls: CatalogScrollState[];
    contentSortMode: XtreamCategorySortMode;
    categorySearchTerm: string;
    minRating: number | null;
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
    visibleCount: CATALOG_INITIAL_WINDOW,
    savedCatalogScrolls: [],
    contentSortMode: 'date-desc',
    categorySearchTerm: '',
    minRating: null,
    isLoadingDetails: false,
    detailsError: null,
};

const matchesCurrentSelection = (
    snapshot: CatalogScrollState,
    current: Omit<CatalogScrollState, 'visibleCount' | 'scrollTop'>
): boolean =>
    snapshot.contentType === current.contentType &&
    snapshot.categoryId === current.categoryId &&
    snapshot.searchTerm === current.searchTerm &&
    snapshot.sortMode === current.sortMode &&
    snapshot.minRating === current.minRating;

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
    readonly info?:
        | {
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
          }
        | []
        | null;
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

const parseRatingValue = (value: unknown): number | null => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

/**
 * Numeric IMDb-style rating used for sorting/filtering. Mirrors the grid badge
 * (prefers `rating_imdb`, falls back to the generic `rating`), checking the
 * stream-list shape first and the nested `info` object as a fallback. Returns
 * null when no parseable rating exists.
 */
export const getNumericRating = (
    item: XtreamSelectionItem
): number | null => {
    const info =
        item.info && !Array.isArray(item.info)
            ? (item.info as Record<string, unknown>)
            : null;
    const record = item as Record<string, unknown>;
    for (const field of ['rating_imdb', 'rating'] as const) {
        const direct = parseRatingValue(record[field]);
        if (direct !== null) {
            return direct;
        }
        const nested = info ? parseRatingValue(info[field]) : null;
        if (nested !== null) {
            return nested;
        }
    }
    return null;
};

/**
 * Filter VOD/series items by a minimum IMDb rating. Unrated items are excluded
 * while a threshold is active.
 */
export const filterByMinRating = (
    items: XtreamSelectionItem[],
    minRating: number | null
): XtreamSelectionItem[] => {
    if (minRating === null || minRating <= 0) {
        return items;
    }
    return items.filter((item) => {
        const rating = getNumericRating(item);
        return rating !== null && rating >= minRating;
    });
};

/**
 * Selection feature store for managing UI selection and the infinite-scroll
 * render window. Handles:
 * - Content type selection (live, vod, series)
 * - Category selection
 * - Item selection
 * - Infinite-scroll window (visibleCount) + detail-round-trip scroll restore
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

                    if (
                        sortMode === 'rating-desc' ||
                        sortMode === 'rating-asc'
                    ) {
                        const ratingA = getNumericRating(a);
                        const ratingB = getNumericRating(b);
                        // Unrated items always sink to the bottom, regardless
                        // of sort direction.
                        if (ratingA === null || ratingB === null) {
                            if (ratingA !== ratingB) {
                                return ratingA === null ? 1 : -1;
                            }
                        } else if (ratingA !== ratingB) {
                            return sortMode === 'rating-desc'
                                ? ratingB - ratingA
                                : ratingA - ratingB;
                        }
                        // Equal ratings (or both unrated): alphabetical tiebreak.
                        const ratingTitleA = a.title ?? a.name ?? '';
                        const ratingTitleB = b.title ?? b.name ?? '';
                        return COLLATOR.compare(ratingTitleA, ratingTitleB);
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
            const selectedTypeCountsReady = computed(() =>
                selectedTypeContentReady()
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

                if (categoryType === 'vod' || categoryType === 'series') {
                    const minRating = store.minRating();
                    let filtered = categoryId
                        ? content.filter(
                              (item) => Number(item.category_id) === categoryId
                          )
                        : sortedContent();

                    filtered = filterBySearchTerm(filtered, searchTerm);
                    filtered = filterByMinRating(filtered, minRating);
                    return categoryId || searchTerm || minRating
                        ? sortByMode(filtered, sortMode, categoryType)
                        : filtered;
                }

                if (!categoryId) {
                    return filterBySearchTerm(sortedContent(), searchTerm);
                }

                const filtered = content.filter(
                    (item) => Number(item.category_id) === categoryId
                );
                return filterBySearchTerm(filtered, searchTerm);
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
                 * The visible slice of the selected category — the first
                 * `visibleCount` items of the stable `filteredAndSortedContent`
                 * intermediate, so growing the window never re-sorts the array.
                 */
                getPaginatedContent: computed(() =>
                    filteredAndSortedContent().slice(0, store.visibleCount())
                ),

                /**
                 * Get all items from the selected category (without pagination).
                 * Reuses the `filteredAndSortedContent` intermediate to avoid
                 * duplicating the filter+sort work already done for pagination.
                 */
                selectItemsFromSelectedCategory: computed(() =>
                    filteredAndSortedContent()
                ),

                /**
                 * Whether the filtered list extends beyond the current render
                 * window.
                 */
                hasMoreContent: computed(
                    () =>
                        filteredAndSortedContent().length > store.visibleCount()
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
                    visibleCount: CATALOG_INITIAL_WINDOW,
                    categorySearchTerm: '',
                    minRating: null,
                });
            },

            /**
             * Set the selected category
             * Only resets the render window when the category actually changes
             */
            setSelectedCategory(categoryId: number | null): void {
                const newCategoryId =
                    categoryId !== null ? Number(categoryId) : null;
                const currentCategoryId = store.selectedCategoryId();

                // Only reset the window if the category actually changed
                if (currentCategoryId !== newCategoryId) {
                    patchState(store, {
                        selectedCategoryId: newCategoryId,
                        visibleCount: CATALOG_INITIAL_WINDOW,
                        categorySearchTerm: '',
                        // Clear the rating filter on category change too, mirroring
                        // categorySearchTerm and setSelectedContentType — otherwise a
                        // stale threshold stays silently applied in the new category.
                        minRating: null,
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
             * Reveal the next chunk of the filtered list. No-op once the
             * window already covers everything.
             */
            loadMoreContent(): void {
                const total = store.selectItemsFromSelectedCategory().length;
                if (store.visibleCount() >= total) {
                    return;
                }

                patchState(store, {
                    visibleCount: store.visibleCount() + CATALOG_WINDOW_CHUNK,
                });
            },

            /**
             * Capture the grid scroll offset together with the selection
             * coordinates it belongs to. One snapshot per selection identity:
             * re-saving the same list replaces its entry, saving another list
             * (a tab detour's destroy hook) leaves it intact, and the oldest
             * entry falls out past the bound.
             */
            saveCatalogScrollState(scrollTop: number): void {
                const snapshot: CatalogScrollState = {
                    contentType: store.selectedContentType(),
                    categoryId: store.selectedCategoryId(),
                    searchTerm: store.categorySearchTerm(),
                    sortMode: store.contentSortMode(),
                    minRating: store.minRating(),
                    visibleCount: store.visibleCount(),
                    scrollTop,
                };

                patchState(store, {
                    savedCatalogScrolls: [
                        ...store
                            .savedCatalogScrolls()
                            .filter(
                                (saved) =>
                                    !matchesCurrentSelection(saved, snapshot)
                            ),
                        snapshot,
                    ].slice(-MAX_SAVED_CATALOG_SCROLLS),
                });
            },

            /**
             * If a snapshot exists for the current selection, restore its
             * render window, remove it, and return the scroll offset to
             * re-apply. Returns null (leaving other snapshots intact)
             * otherwise, so a detour through another list never destroys a
             * saved spot.
             */
            consumeCatalogScrollState(): number | null {
                const current = {
                    contentType: store.selectedContentType(),
                    categoryId: store.selectedCategoryId(),
                    searchTerm: store.categorySearchTerm(),
                    sortMode: store.contentSortMode(),
                    minRating: store.minRating(),
                };
                const saved = store
                    .savedCatalogScrolls()
                    .find((snapshot) =>
                        matchesCurrentSelection(snapshot, current)
                    );
                if (!saved) {
                    return null;
                }

                patchState(store, {
                    visibleCount: saved.visibleCount,
                    savedCatalogScrolls: store
                        .savedCatalogScrolls()
                        .filter((snapshot) => snapshot !== saved),
                });
                return saved.scrollTop;
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
                    visibleCount: CATALOG_INITIAL_WINDOW,
                });
            },

            /**
             * Set the minimum IMDb rating filter for VOD/series content.
             * A null or non-positive value clears the filter.
             */
            setMinRating(value: number | null): void {
                const normalized = value && value > 0 ? value : null;
                if (store.minRating() === normalized) {
                    return;
                }
                patchState(store, {
                    minRating: normalized,
                    visibleCount: CATALOG_INITIAL_WINDOW,
                });
            },

            /**
             * Set selected category search term
             */
            setCategorySearchTerm(term: string): void {
                if (store.categorySearchTerm() === term) {
                    return;
                }

                patchState(store, {
                    categorySearchTerm: term,
                    visibleCount: CATALOG_INITIAL_WINDOW,
                });
            },

            /**
             * Reset selection state
             */
            resetSelection(): void {
                patchState(store, initialSelectionState);
            },
        }))
    );
}
