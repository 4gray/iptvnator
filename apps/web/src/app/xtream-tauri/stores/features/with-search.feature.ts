import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { GlobalSearchResult } from 'services';
import {
    XTREAM_DATA_SOURCE,
    XtreamContentItem,
} from '../../data-sources/xtream-data-source.interface';

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
    return signalStoreFeature(
        withState<SearchState>(initialSearchState),

        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);

            return {
                /**
                 * Search content within the current playlist
                 */
                async searchContent(
                    searchTerm: string,
                    types: string[]
                ): Promise<XtreamContentItem[]> {
                    // Access parent store's playlistId (from withPortal)
                    const storeAny = store as any;
                    const playlistId = storeAny.playlistId?.();

                    if (!playlistId || !searchTerm.trim()) {
                        patchState(store, { searchResults: [] });
                        return [];
                    }

                    patchState(store, { isSearching: true });

                    try {
                        const results = await dataSource.searchContent(
                            playlistId,
                            searchTerm,
                            types
                        );

                        patchState(store, {
                            searchResults: results,
                            isSearching: false,
                        });

                        return results;
                    } catch (error) {
                        console.error('Error searching content:', error);
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
                    patchState(store, {
                        searchResults: results as any,
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
                    patchState(store, initialSearchState);
                },
            };
        })
    );
}
