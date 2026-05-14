import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { GlobalSearchResult } from 'services';
import {
    XTREAM_DATA_SOURCE,
    XtreamContentItem,
} from '../../data-sources/xtream-data-source.interface';
import {
    groupXtreamSeriesDuplicates,
    groupXtreamVodDuplicates,
    matchesXtreamSeriesSearchTerm,
    matchesXtreamVodSearchTerm,
} from '../../utils/vod-duplicates.util';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    matchesXtreamLanguageFilter,
    XtreamLanguageFilterCandidate,
    XtreamLanguageFilterState,
} from '../../utils/language-filter.util';

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
    searchResults: XtreamContentItem[];
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
        languageFilter?: () => XtreamLanguageFilterState;
        playlistId?: () => string | null;
    };

    return signalStoreFeature(
        withState<SearchState>(initialSearchState),

        withComputed((store) => ({
            filteredSearchResults: computed(() => {
                const storeAny = store as ParentSearchStoreLike;
                const languageFilter = storeAny.languageFilter?.();
                if (!languageFilter) {
                    return store.searchResults();
                }

                return store
                    .searchResults()
                    .filter((item) =>
                        matchesXtreamLanguageFilter(
                            item as unknown as XtreamLanguageFilterCandidate,
                            languageFilter
                        )
                    );
            }),
        })),

        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);
            let searchRequestVersion = 0;
            const prepareSearchResults = (
                results: XtreamContentItem[],
                searchTerm: string
            ): XtreamContentItem[] => {
                const movieResults = results.filter(
                    (item) => item.type === 'movie'
                );
                const seriesResults = results.filter(
                    (item) => item.type === 'series'
                );
                const otherResults = results.filter(
                    (item) => item.type !== 'movie' && item.type !== 'series'
                );
                const groupedMovies = groupXtreamVodDuplicates(
                    movieResults
                ).filter((item) =>
                    matchesXtreamVodSearchTerm(item, searchTerm)
                );
                const groupedSeries = groupXtreamSeriesDuplicates(
                    seriesResults
                ).filter((item) =>
                    matchesXtreamSeriesSearchTerm(item, searchTerm)
                );

                return [...otherResults, ...groupedMovies, ...groupedSeries];
            };

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
                        patchState(store, {
                            searchResults: [],
                            isSearching: false,
                        });
                        return [];
                    }

                    patchState(store, { isSearching: true });

                    try {
                        const results = await dataSource.searchContent(
                            playlistId,
                            searchTerm,
                            types,
                            excludeHidden
                        );
                        const preparedResults = prepareSearchResults(
                            results,
                            searchTerm
                        );

                        if (requestVersion !== searchRequestVersion) {
                            return preparedResults;
                        }

                        patchState(store, {
                            searchResults: preparedResults,
                            isSearching: false,
                        });

                        return preparedResults;
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
                 * Set global search results (from external search)
                 */
                setGlobalSearchResults(results: GlobalSearchResult[]): void {
                    const preparedResults = prepareSearchResults(
                        results as XtreamContentItem[],
                        store.searchTerm()
                    );

                    patchState(store, {
                        searchResults: preparedResults,
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
                    patchState(store, initialSearchState);
                },
            };
        })
    );
}
