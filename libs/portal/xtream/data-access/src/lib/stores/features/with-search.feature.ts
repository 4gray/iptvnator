import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { GlobalSearchResult } from '@iptvnator/shared/interfaces';
import {
    measureRendererPerformancePhase,
    RENDERER_PERFORMANCE_PHASE,
} from '@iptvnator/shared/logging';
import {
    XTREAM_DATA_SOURCE,
    XtreamContentItem,
} from '../../data-sources/xtream-data-source.interface';
import { createLogger } from '@iptvnator/portal/shared/util';
import { XtreamSearchResultItem } from '../../xtream-state';

/**
 * Search filters configuration
 */
export interface SearchFilters {
    live: boolean;
    movie: boolean;
    series: boolean;
}

/**
 * Search state for managing search results
 */
export interface SearchState {
    searchTerm: string;
    searchFilters: SearchFilters;
    searchResults: XtreamSearchResultItem[];
    globalSearchResults: GlobalSearchResult[];
    isSearching: boolean;
}

type SearchContentParams = {
    term: string;
    types: string[];
    excludeHidden?: boolean;
};

/**
 * Initial search filters
 */
const initialSearchFilters: SearchFilters = {
    live: true,
    movie: true,
    series: true,
};

/**
 * Initial search state
 */
const initialSearchState: SearchState = {
    searchTerm: '',
    searchFilters: initialSearchFilters,
    searchResults: [],
    globalSearchResults: [],
    isSearching: false,
};

/**
 * Search feature store for managing content search.
 * Handles:
 * - Local playlist search
 * - Global search results from external sources
 */
export function withSearch() {
    const logger = createLogger('withSearch');
    type ParentSearchStoreLike = {
        playlistId?: () => string | null;
    };

    return signalStoreFeature(
        withState<SearchState>(initialSearchState),

        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);
            let searchRequestVersion = 0;
            /** The last in-portal search, so it can be re-run as issued. */
            let lastSearch: SearchContentParams | null = null;

            return {
                /**
                 * Search content within the current playlist
                 */
                async searchContent(
                    searchTermOrParams: string | SearchContentParams,
                    typesArg?: string[],
                    excludeHiddenArg?: boolean
                ): Promise<XtreamContentItem[]> {
                    const searchTerm =
                        typeof searchTermOrParams === 'string'
                            ? searchTermOrParams
                            : searchTermOrParams.term;
                    const types =
                        typeof searchTermOrParams === 'string'
                            ? (typesArg ?? [])
                            : searchTermOrParams.types;
                    const excludeHidden =
                        typeof searchTermOrParams === 'string'
                            ? excludeHiddenArg
                            : searchTermOrParams.excludeHidden;

                    // Access parent store's playlistId (from withPortal)
                    const storeAny = store as ParentSearchStoreLike;
                    const playlistId = storeAny.playlistId?.();
                    const requestVersion = ++searchRequestVersion;

                    if (!playlistId || !searchTerm.trim()) {
                        lastSearch = null;
                        patchState(store, {
                            searchResults: [],
                            isSearching: false,
                        });
                        return [];
                    }
                    lastSearch = { term: searchTerm, types, excludeHidden };

                    patchState(store, { isSearching: true });

                    try {
                        const results = await dataSource.searchContent(
                            playlistId,
                            searchTerm,
                            types,
                            excludeHidden
                        );

                        if (requestVersion !== searchRequestVersion) {
                            return results;
                        }

                        measureRendererPerformancePhase(
                            RENDERER_PERFORMANCE_PHASE.XTREAM_SEARCH_RESULTS,
                            () =>
                                patchState(store, {
                                    searchResults: results,
                                    isSearching: false,
                                }),
                            () => ({ items: results.length })
                        );

                        return results;
                    } catch (error) {
                        logger.error('Error searching content', error);

                        if (requestVersion !== searchRequestVersion) {
                            return [];
                        }

                        patchState(store, {
                            searchResults: [],
                            isSearching: false,
                        });
                        return [];
                    }
                },

                /**
                 * Re-runs the last in-portal search with its own parameters,
                 * so stored results reflect the current read filters (the
                 * parental lock) without the page having to search again.
                 */
                async refreshSearchResults(): Promise<void> {
                    if (!lastSearch) {
                        return;
                    }
                    await this.searchContent(lastSearch);
                },

                /**
                 * Set global search results (from external search)
                 */
                setGlobalSearchResults(results: GlobalSearchResult[]): void {
                    patchState(store, {
                        searchResults: results,
                        globalSearchResults: results,
                        isSearching: false,
                    });
                },

                /**
                 * Set the searching state
                 */
                setIsSearching(value: boolean): void {
                    patchState(store, { isSearching: value });
                },

                /**
                 * Set the search term
                 */
                setSearchTerm(term: string): void {
                    patchState(store, { searchTerm: term });
                },

                /**
                 * Set search filters
                 */
                setSearchFilters(filters: SearchFilters): void {
                    patchState(store, { searchFilters: filters });
                },

                /**
                 * Update a single filter
                 */
                updateSearchFilter(
                    key: keyof SearchFilters,
                    value: boolean
                ): void {
                    patchState(store, {
                        searchFilters: {
                            ...store.searchFilters(),
                            [key]: value,
                        },
                    });
                },

                /**
                 * Clear search results
                 */
                resetSearchResults(): void {
                    searchRequestVersion++;
                    lastSearch = null;
                    patchState(store, initialSearchState);
                },
            };
        })
    );
}
