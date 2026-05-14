import { computed } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { ContentType, XtreamContentLoadState } from '../../xtream-state';
import {
    groupXtreamSeriesDuplicates,
    groupXtreamVodDuplicates,
    matchesXtreamSeriesSearchTerm,
    matchesXtreamVodSearchTerm,
} from '../../utils/vod-duplicates.util';
import {
    EMPTY_XTREAM_LANGUAGE_FILTER,
    getXtreamLanguageOptions,
    isXtreamLanguageFilterActive,
    matchesXtreamLanguageFilter,
    XtreamLanguageFilterCandidate,
    XtreamLanguageFilterSection,
    XtreamLanguageFilterState,
} from '../../utils/language-filter.util';
import {
    getXtreamVideoQualityOptions,
    isXtreamVideoQualityFilterActive,
    matchesXtreamVideoQualityFilter,
    XtreamVideoQualityFilterCandidate,
    XtreamVideoQualityFilterValue,
} from '../../utils/video-quality-filter.util';

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
    | 'rating-desc';

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
    languageFilter: XtreamLanguageFilterState;
    videoQualityFilter: XtreamVideoQualityFilterValue;
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
    languageFilter: EMPTY_XTREAM_LANGUAGE_FILTER,
    videoQualityFilter: 'all',
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
    readonly duplicateGroupKey?: string;
    readonly episodes?: unknown;
    readonly id?: string | number;
    readonly imdbRating?: number | string;
    readonly imdb_id?: string;
    readonly imdbMatchedTitle?: string;
    readonly imdbMatchedYear?: string | number;
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
              readonly tmdb_id?: string | number;
              readonly tvdb_id?: string | number;
              readonly youtube_trailer?: string;
          }
        | []
        | null;
    readonly last_modified?: string;
    readonly movie_data?: {
        readonly container_extension?: string;
        readonly name?: string;
        readonly stream_id?: string | number;
        readonly title?: string;
        readonly tmdb_id?: string | number;
        readonly tvdb_id?: string | number;
    };
    readonly name?: string;
    readonly rating?: number | string;
    readonly rating_5based?: number | string;
    readonly rating_imdb?: string;
    readonly rating_kinopoisk?: string;
    readonly series_id?: string | number;
    readonly stream_id?: string | number;
    readonly title?: string;
    readonly tmdb_id?: string | number;
    readonly tvdb_id?: string | number;
    readonly xtream_id?: string | number;
    readonly year?: string | number;
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

            const parseRating = (value: unknown): number | null => {
                if (typeof value === 'number') {
                    return Number.isFinite(value) ? value : null;
                }

                if (typeof value !== 'string') {
                    return null;
                }

                const normalized = value.trim().replace(',', '.');
                if (!normalized) {
                    return null;
                }

                const match = normalized.match(/\d+(?:\.\d+)?/);
                if (!match) {
                    return null;
                }

                const rating = Number.parseFloat(match[0]);
                return Number.isFinite(rating) ? rating : null;
            };

            const getItemRating = (
                item: XtreamSelectionItem
            ): number | null => {
                const info =
                    item.info && !Array.isArray(item.info) ? item.info : null;

                return (
                    parseRating(item.imdbRating) ??
                    parseRating(item.rating_imdb) ??
                    parseRating(info?.rating_imdb)
                );
            };

            const sortByMode = (
                items: XtreamSelectionItem[],
                sortMode: XtreamCategorySortMode,
                categoryType: ContentType
            ): XtreamSelectionItem[] => {
                return [...items].sort((a, b) => {
                    const titleA = a.title ?? a.name ?? '';
                    const titleB = b.title ?? b.name ?? '';

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
                    if (sortMode === 'rating-desc') {
                        const ratingA = getItemRating(a);
                        const ratingB = getItemRating(b);

                        if (ratingA === null && ratingB === null) {
                            return COLLATOR.compare(titleA, titleB);
                        }
                        if (ratingA === null) {
                            return 1;
                        }
                        if (ratingB === null) {
                            return -1;
                        }

                        const byRating = ratingB - ratingA;
                        return byRating === 0
                            ? COLLATOR.compare(titleA, titleB)
                            : byRating;
                    }

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

            const filterVodGroupsBySearchTerm = (
                items: XtreamSelectionItem[],
                searchTerm: string
            ): XtreamSelectionItem[] => {
                if (!searchTerm.trim()) {
                    return items;
                }

                return items.filter((item) =>
                    matchesXtreamVodSearchTerm(item, searchTerm)
                );
            };

            const filterSeriesGroupsBySearchTerm = (
                items: XtreamSelectionItem[],
                searchTerm: string
            ): XtreamSelectionItem[] => {
                if (!searchTerm.trim()) {
                    return items;
                }

                return items.filter((item) =>
                    matchesXtreamSeriesSearchTerm(item, searchTerm)
                );
            };

            const filterByLanguage = (
                items: XtreamSelectionItem[]
            ): XtreamSelectionItem[] => {
                const filter = store.languageFilter();
                if (!isXtreamLanguageFilterActive(filter)) {
                    return items;
                }

                return items.filter((item) =>
                    matchesXtreamLanguageFilter(
                        item as XtreamLanguageFilterCandidate,
                        filter
                    )
                );
            };

            const supportsVideoQualityFilter = (
                categoryType: ContentType
            ): boolean => categoryType === 'vod' || categoryType === 'series';

            const filterByVideoQuality = (
                items: XtreamSelectionItem[],
                categoryType: ContentType
            ): XtreamSelectionItem[] => {
                const filter = store.videoQualityFilter();
                if (
                    !supportsVideoQualityFilter(categoryType) ||
                    !isXtreamVideoQualityFilterActive(filter)
                ) {
                    return items;
                }

                return items.filter((item) =>
                    matchesXtreamVideoQualityFilter(
                        item as XtreamVideoQualityFilterCandidate,
                        filter
                    )
                );
            };

            const applyCatalogFilters = (
                items: XtreamSelectionItem[],
                categoryType: ContentType
            ): XtreamSelectionItem[] =>
                filterByVideoQuality(filterByLanguage(items), categoryType);

            const hasActiveCatalogFilters = (
                categoryType: ContentType
            ): boolean =>
                isXtreamLanguageFilterActive(store.languageFilter()) ||
                (supportsVideoQualityFilter(categoryType) &&
                    isXtreamVideoQualityFilterActive(
                        store.videoQualityFilter()
                    ));

            const getStreamsByType = (
                categoryType: ContentType
            ): XtreamSelectionItem[] => {
                const storeAny = store as ParentSelectionStoreLike;
                return categoryType === 'live'
                    ? storeAny.liveStreams?.() || []
                    : categoryType === 'vod'
                      ? storeAny.vodStreams?.() || []
                      : storeAny.serialStreams?.() || [];
            };

            // ---------------------------------------------------------------------------
            // Per-type category item-count maps.
            // Each computed only recomputes when ITS streams array changes —
            // switching content tabs no longer triggers an O(n) full scan.
            // ---------------------------------------------------------------------------
            const buildCountMap = (
                streams: XtreamSelectionItem[]
            ): Map<number, number> => {
                const countMap = new Map<number, number>();
                for (const item of filterByLanguage(streams)) {
                    const catId = Number(item.category_id);
                    if (!isNaN(catId)) {
                        countMap.set(catId, (countMap.get(catId) || 0) + 1);
                    }
                }
                return countMap;
            };

            const buildVodCountMap = (
                streams: XtreamSelectionItem[]
            ): Map<number, number> => {
                return buildDuplicateCountMap(
                    streams,
                    groupXtreamVodDuplicates,
                    'vod'
                );
            };

            const buildSeriesCountMap = (
                streams: XtreamSelectionItem[]
            ): Map<number, number> => {
                return buildDuplicateCountMap(
                    streams,
                    groupXtreamSeriesDuplicates,
                    'series'
                );
            };

            const buildDuplicateCountMap = (
                streams: XtreamSelectionItem[],
                groupItems: (
                    items: readonly XtreamSelectionItem[]
                ) => XtreamSelectionItem[],
                categoryType: ContentType
            ): Map<number, number> => {
                const streamsByCategory = new Map<
                    number,
                    XtreamSelectionItem[]
                >();

                for (const item of streams) {
                    const catId = Number(item.category_id);
                    if (isNaN(catId)) {
                        continue;
                    }

                    const categoryStreams = streamsByCategory.get(catId) ?? [];
                    categoryStreams.push(item);
                    streamsByCategory.set(catId, categoryStreams);
                }

                const countMap = new Map<number, number>();
                for (const [catId, categoryStreams] of streamsByCategory) {
                    countMap.set(
                        catId,
                        applyCatalogFilters(
                            groupItems(categoryStreams),
                            categoryType
                        ).length
                    );
                }

                return countMap;
            };

            const liveItemCounts = computed(() =>
                buildCountMap(
                    (store as ParentSelectionStoreLike).liveStreams?.() || []
                )
            );
            const vodItemCounts = computed(() =>
                buildVodCountMap(
                    (store as ParentSelectionStoreLike).vodStreams?.() || []
                )
            );
            const seriesItemCounts = computed(() =>
                buildSeriesCountMap(
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
            const searchMatchedContent = computed(() => {
                const categoryId = store.selectedCategoryId();
                const categoryType = store.selectedContentType();
                const searchTerm = store.categorySearchTerm();
                const content = getStreamsByType(categoryType);
                const scopedContent = categoryId
                    ? content.filter(
                          (item) => Number(item.category_id) === categoryId
                      )
                    : content;

                if (categoryType === 'vod') {
                    return filterVodGroupsBySearchTerm(
                        groupXtreamVodDuplicates(scopedContent),
                        searchTerm
                    );
                }

                if (categoryType === 'series') {
                    return filterSeriesGroupsBySearchTerm(
                        groupXtreamSeriesDuplicates(scopedContent),
                        searchTerm
                    );
                }

                return filterBySearchTerm(scopedContent, searchTerm);
            });

            const filteredAndSortedContent = computed(() => {
                const categoryType = store.selectedContentType();
                const sortMode = store.contentSortMode();

                return sortByMode(
                    applyCatalogFilters(searchMatchedContent(), categoryType),
                    sortMode,
                    categoryType
                );
            });

            const getSelectionItemKey = (
                item: XtreamSelectionItem,
                categoryType: ContentType
            ): string => {
                const id =
                    item.duplicateGroupKey ??
                    (categoryType === 'series'
                        ? (item.series_id ?? item.xtream_id ?? item.id)
                        : (item.xtream_id ??
                          item.stream_id ??
                          item.series_id ??
                          item.id));

                return `${categoryType}:${String(
                    id ?? item.title ?? item.name ?? ''
                )}`;
            };

            const filterExcludedContent = computed(() => {
                const categoryType = store.selectedContentType();
                if (!hasActiveCatalogFilters(categoryType)) {
                    return [];
                }

                const includedKeys = new Set(
                    filteredAndSortedContent().map((item) =>
                        getSelectionItemKey(item, categoryType)
                    )
                );
                const excluded = searchMatchedContent().filter(
                    (item) =>
                        !includedKeys.has(
                            getSelectionItemKey(item, categoryType)
                        )
                );

                return sortByMode(
                    excluded,
                    store.contentSortMode(),
                    categoryType
                );
            });

            const getVideoQualityOptionItems = (): XtreamSelectionItem[] => {
                const categoryId = store.selectedCategoryId();
                const categoryType = store.selectedContentType();
                const searchTerm = store.categorySearchTerm();

                if (!supportsVideoQualityFilter(categoryType)) {
                    return [];
                }

                const content = getStreamsByType(categoryType);
                let filtered = categoryId
                    ? content.filter(
                          (item) => Number(item.category_id) === categoryId
                      )
                    : content;

                filtered =
                    categoryType === 'vod'
                        ? groupXtreamVodDuplicates(filtered)
                        : groupXtreamSeriesDuplicates(filtered);
                filtered =
                    categoryType === 'vod'
                        ? filterVodGroupsBySearchTerm(filtered, searchTerm)
                        : filterSeriesGroupsBySearchTerm(filtered, searchTerm);

                return filterByLanguage(filtered);
            };

            return {
                languageFilterOptions: computed(() => {
                    const storeAny = store as ParentSelectionStoreLike;
                    return getXtreamLanguageOptions(
                        [
                            ...(storeAny.liveStreams?.() ?? []),
                            ...(storeAny.vodStreams?.() ?? []),
                            ...(storeAny.serialStreams?.() ?? []),
                        ] as XtreamLanguageFilterCandidate[],
                        store.languageFilter()
                    );
                }),

                languageFilterActive: computed(() =>
                    isXtreamLanguageFilterActive(store.languageFilter())
                ),

                videoQualityFilterOptions: computed(() =>
                    getXtreamVideoQualityOptions(
                        getVideoQualityOptionItems() as XtreamVideoQualityFilterCandidate[],
                        store.videoQualityFilter()
                    )
                ),

                videoQualityFilterActive: computed(() =>
                    isXtreamVideoQualityFilterActive(store.videoQualityFilter())
                ),

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

                selectFilterExcludedItemsFromSelectedCategory: computed(() =>
                    filterExcludedContent()
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
                if (store.categorySearchTerm() === term) {
                    return;
                }

                patchState(store, {
                    categorySearchTerm: term,
                    page: 0,
                });
            },

            toggleLanguageFilterOption(
                section: XtreamLanguageFilterSection,
                code: string,
                enabled: boolean
            ): void {
                const normalizedCode = code.trim().toLowerCase();
                if (!normalizedCode) {
                    return;
                }

                const current = store.languageFilter();
                const selected = new Set(current[section]);
                if (enabled) {
                    selected.add(normalizedCode);
                } else {
                    selected.delete(normalizedCode);
                }

                patchState(store, {
                    languageFilter: {
                        ...current,
                        [section]: [...selected].sort(),
                    },
                    page: 0,
                });
            },

            selectAllLanguageFilterOptions(
                section: XtreamLanguageFilterSection
            ): void {
                patchState(store, {
                    languageFilter: {
                        ...store.languageFilter(),
                        [section]: store
                            .languageFilterOptions()
                            .map((option) => option.code)
                            .sort(),
                    },
                    page: 0,
                });
            },

            clearLanguageFilterOptions(
                section: XtreamLanguageFilterSection
            ): void {
                patchState(store, {
                    languageFilter: {
                        ...store.languageFilter(),
                        [section]: [],
                    },
                    page: 0,
                });
            },

            invertLanguageFilterOptions(
                section: XtreamLanguageFilterSection
            ): void {
                const current = store.languageFilter();
                const selected = new Set(current[section]);
                const inverted = store
                    .languageFilterOptions()
                    .map((option) => option.code)
                    .filter((code) => !selected.has(code))
                    .sort();

                patchState(store, {
                    languageFilter: {
                        ...current,
                        [section]: inverted,
                    },
                    page: 0,
                });
            },

            resetLanguageFilter(): void {
                patchState(store, {
                    languageFilter: EMPTY_XTREAM_LANGUAGE_FILTER,
                    page: 0,
                });
            },

            setVideoQualityFilter(filter: XtreamVideoQualityFilterValue): void {
                if (store.videoQualityFilter() === filter) {
                    return;
                }

                patchState(store, {
                    videoQualityFilter: filter,
                    page: 0,
                });
            },

            resetVideoQualityFilter(): void {
                patchState(store, {
                    videoQualityFilter: 'all',
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
