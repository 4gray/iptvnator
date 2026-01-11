import { computed, inject } from '@angular/core';
import {
    signalStore,
    withComputed,
    withMethods,
} from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { selectActivePlaylist } from 'm3u-state';
import { DataService } from 'services';
import {
    XtreamCodeActions,
    XtreamSerieDetails,
    XtreamVodDetails,
} from 'shared-interfaces';

// Import existing features that are already separate
import { withFavorites } from '../with-favorites.feature';
import { withRecentItems } from '../with-recent-items';

// Import new feature stores
import {
    withPortal,
    withContent,
    withSelection,
    withSearch,
    withEpg,
    withPlayer,
} from './features';

/**
 * XtreamStore - Facade composing all feature stores.
 *
 * This store provides a unified API for components while delegating
 * to specialized feature stores for different concerns:
 *
 * - withPortal: Playlist and portal status management
 * - withContent: Categories and streams management
 * - withSelection: UI selection and pagination
 * - withSearch: Search functionality
 * - withEpg: EPG (Electronic Program Guide) data
 * - withPlayer: Stream URL construction and player integration
 * - withFavorites: Favorites management
 * - withRecentItems: Recently viewed items
 *
 * @see docs/XTREAM_STORE_REFACTORING_PLAN.md
 */
export const XtreamStore = signalStore(
    // Note: NOT providedIn: 'root' because shell provides it
    // This matches the original behavior

    // Compose all features
    withPortal(),
    withContent(),
    withSelection(),
    withSearch(),
    withEpg(),
    withPlayer(),
    withFavorites(),
    withRecentItems(),

    // Cross-feature computed properties
    withComputed((store) => ({
        /**
         * Get global recent items (from withRecentItems)
         */
        globalRecentItems: computed(() => {
            return store.recentItems();
        }),

        /**
         * Alias for importCount for backward compatibility
         */
        getImportCount: computed(() => store.importCount()),
    })),

    // Cross-feature methods & orchestration
    withMethods((store) => {
        const dataService = inject(DataService);
        const ngrxStore = inject(Store);

        return {
            /**
             * Full store reset for switching between playlists
             */
            resetStore(newPlaylistId?: string): void {
                store.resetPortal();
                store.resetContent();
                store.resetSelection();
                store.resetSearchResults();
                store.clearEpg();
                store.resetPlayer();

                if (newPlaylistId) {
                    store.setPlaylistId(newPlaylistId);
                }
            },

            /**
             * Initialize the store for a playlist
             */
            async initialize(): Promise<void> {
                await store.fetchPlaylist();
                await store.checkPortalStatus();
                await store.initializeContent();
            },

            /**
             * Fetch Xtream playlist (convenience alias)
             */
            async fetchXtreamPlaylist(): Promise<void> {
                await store.fetchPlaylist();
            },

            /**
             * Fetch VOD details with metadata
             * Accepts object format for backward compatibility with rxMethod callers
             */
            fetchVodDetailsWithMetadata(
                params: { vodId: string; categoryId: number }
            ): void {
                const playlist = ngrxStore.selectSignal(selectActivePlaylist)();
                if (!playlist) return;

                dataService.fetchData(
                    `${playlist.serverUrl}/player_api.php`,
                    {
                        action: XtreamCodeActions.GetVodInfo,
                        username: playlist.username,
                        password: playlist.password,
                        vod_id: params.vodId,
                    }
                ).then((vodDetails: XtreamVodDetails) => {
                    store.setSelectedCategory(params.categoryId);
                    store.setSelectedItem({
                        ...vodDetails,
                        stream_id: params.vodId,
                    });
                }).catch((error: unknown) => {
                    console.error('Error fetching VOD details:', error);
                });
            },

            /**
             * Fetch series details with metadata
             * Accepts object format for backward compatibility with rxMethod callers
             */
            fetchSerialDetailsWithMetadata(
                params: { serialId: string; categoryId: number }
            ): void {
                const playlist = ngrxStore.selectSignal(selectActivePlaylist)();
                if (!playlist) return;

                dataService.fetchData(
                    `${playlist.serverUrl}/player_api.php`,
                    {
                        action: XtreamCodeActions.GetSeriesInfo,
                        username: playlist.username,
                        password: playlist.password,
                        series_id: params.serialId,
                    }
                ).then((serialDetails: XtreamSerieDetails) => {
                    store.setSelectedCategory(params.categoryId);
                    store.setSelectedItem({
                        ...serialDetails,
                        series_id: params.serialId,
                    });
                }).catch((error: unknown) => {
                    console.error('Error fetching series details:', error);
                });
            },

            /**
             * Legacy method stubs for backward compatibility
             */
            createLinkToPlayVod(): void {
                // No-op, kept for compatibility
            },

            addToFavorites(item: unknown): void {
                console.log('Legacy addToFavorites called', item);
            },

            removeFromFavorites(favoriteId: string): void {
                console.log('Legacy removeFromFavorites called', favoriteId);
            },

            // Alias methods for backward compatibility
            fetchLiveCategories(): void {
                store.fetchAllCategories();
            },

            fetchVodCategories(): void {
                store.fetchAllCategories();
            },

            fetchSerialCategories(): void {
                store.fetchAllCategories();
            },

            fetchLiveStreams(): void {
                store.fetchAllContent();
            },

            fetchVodStreams(): void {
                store.fetchAllContent();
            },

            fetchSerialStreams(): void {
                store.fetchAllContent();
            },

            /**
             * Search content wrapper for rxMethod compatibility
             * Can be called with object { term, types } or direct params
             */
            searchContent(params: { term: string; types: string[] }): void {
                // Call the underlying search method from withSearch
                (store as any).searchContent(params.term, params.types);
            },
        };
    })
);

// Type alias for the store
export type XtreamStoreType = InstanceType<typeof XtreamStore>;
