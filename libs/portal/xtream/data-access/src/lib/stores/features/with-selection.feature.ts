import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    type,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import type { PortalWatchStateFilter } from '@iptvnator/portal/shared/util/tokens';
import type { PlaybackPositionsState } from './with-playback-positions.feature';
import { filterXtreamVodByWatchState } from './xtream-vod-watch-filter';
import { ContentType } from '../../xtream-state';
import {
    CATALOG_INITIAL_WINDOW,
    CATALOG_WINDOW_CHUNK,
    MAX_SAVED_CATALOG_SCROLLS,
    CatalogScrollState,
    SelectionState,
    XtreamCategorySortMode,
    XtreamSelectionCategory,
    XtreamSelectionItem,
    ParentSelectionStoreLike,
    initialSelectionState,
    matchesCurrentSelection,
} from './with-selection.models';
import {
    sortByMode,
    filterBySearchTerm,
    filterByMinRating,
    buildCountMap,
} from './with-selection-content.util';
export {
    CATALOG_INITIAL_WINDOW,
    CATALOG_WINDOW_CHUNK,
} from './with-selection.models';
export type {
    SelectionState,
    CatalogScrollState,
    XtreamCategorySortMode,
} from './with-selection.models';
export {
    getNumericRating,
    filterByMinRating,
} from './with-selection-content.util';

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
        {
            state: type<
                Pick<
                    PlaybackPositionsState,
                    | 'playbackPositions'
                    | 'positionsPlaylistId'
                    | 'positionsLoadState'
                > & { currentPlaylist: { id: string } | null }
            >(),
        },
        withState<SelectionState>(initialSelectionState),

        withComputed((store) => {
            const runtime = inject(RuntimeCapabilitiesService);

            const getVisibleContentForType = (
                contentType: ContentType
            ): XtreamSelectionItem[] => {
                const storeAny = store as ParentSelectionStoreLike;
                const content =
                    contentType === 'live'
                        ? storeAny.liveStreams?.() || []
                        : contentType === 'vod'
                          ? storeAny.vodStreams?.() || []
                          : storeAny.serialStreams?.() || [];

                // API-backed data sources do not support category visibility;
                // preserve streams with missing or unknown category IDs there.
                if (!runtime.supportsXtreamSqliteDataSource) {
                    return content;
                }

                const categories =
                    contentType === 'live'
                        ? storeAny.liveCategories?.() || []
                        : contentType === 'vod'
                          ? storeAny.vodCategories?.() || []
                          : storeAny.serialCategories?.() || [];
                const visibleCategoryIds = new Set(
                    categories
                        .filter((category) => !category.hidden)
                        .map((category) =>
                            Number(category.category_id ?? category.id)
                        )
                );

                return content.filter((item) =>
                    visibleCategoryIds.has(Number(item.category_id))
                );
            };

            // Memoized sorted content - only recalculates when visible content/type changes
            const sortedContent = computed(() => {
                const categoryType = store.selectedContentType();
                const sortMode = store.contentSortMode();
                const content = getVisibleContentForType(categoryType);

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

                if (categoryType === 'vod' || categoryType === 'series') {
                    const minRating = store.minRating();
                    let filtered = categoryId
                        ? getVisibleContentForType(categoryType).filter(
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

                const filtered = getVisibleContentForType(categoryType).filter(
                    (item) => Number(item.category_id) === categoryId
                );
                return filterBySearchTerm(filtered, searchTerm);
            });

            const watchFilteredContent = computed(() => {
                const content = filteredAndSortedContent();
                const filter = store.watchStateFilter();
                if (store.selectedContentType() !== 'vod' || filter === null)
                    return content;
                if (
                    store.positionsPlaylistId() !==
                        store.currentPlaylist()?.id ||
                    store.positionsLoadState() !== 'ready'
                )
                    return [];
                return filterXtreamVodByWatchState(
                    content,
                    filter,
                    store.playbackPositions()
                );
            });

            return {
                /**
                 * Get the selected category from the parent store's categories
                 */
                getSelectedCategory: computed(() => {
                    const categoryId = store.selectedCategoryId();
                    // Every item: the view supplies the translated title.
                    if (!categoryId) {
                        return {
                            id: 0,
                            name: '',
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
                 * Get catalog items that belong to visible categories.
                 * Hidden categories remain in the underlying catalog for
                 * lookups and global search, but are excluded from section views.
                 */
                getVisibleContentByType: computed(
                    () => getVisibleContentForType
                ),

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
                    watchFilteredContent().slice(0, store.visibleCount())
                ),

                /**
                 * Get all items from the selected category (without pagination).
                 * Reuses the `filteredAndSortedContent` intermediate to avoid
                 * duplicating the filter+sort work already done for pagination.
                 */
                selectItemsFromSelectedCategory: computed(() =>
                    watchFilteredContent()
                ),

                /**
                 * Whether the filtered list extends beyond the current render
                 * window.
                 */
                hasMoreContent: computed(
                    () => watchFilteredContent().length > store.visibleCount()
                ),

                /**
                 * Check if paginated content is loading
                 */
                isPaginatedContentLoading: computed(
                    () =>
                        selectedTypeContentLoading() ||
                        (store.selectedContentType() === 'vod' &&
                            store.watchStateFilter() !== null &&
                            store.positionsLoadState() === 'loading')
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
                    watchStateFilter: null,
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
                    watchStateFilter: store.watchStateFilter(),
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
                    watchStateFilter: store.watchStateFilter(),
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
            setWatchStateFilter(value: PortalWatchStateFilter): void {
                if (
                    store.selectedContentType() !== 'vod' ||
                    store.watchStateFilter() === value
                )
                    return;
                patchState(store, {
                    watchStateFilter: value,
                    visibleCount: CATALOG_INITIAL_WINDOW,
                });
            },

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
