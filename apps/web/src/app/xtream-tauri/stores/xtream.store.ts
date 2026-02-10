import { computed, inject } from '@angular/core';
import {
    signalStore,
    withComputed,
    withMethods,
} from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { selectActivePlaylist } from 'm3u-state';
import {
    XtreamSerieDetails,
    XtreamVodDetails,
} from 'shared-interfaces';

// Import existing features that are already separate
import { withFavorites } from '../with-favorites.feature';
import { withRecentItems } from '../with-recent-items';

// Import service
import { XtreamApiService } from '../services/xtream-api.service';

// Import new feature stores
import {
    withPortal,
    withContent,
    withSelection,
    withSearch,
    withEpg,
    withPlayer,
    withPlaybackPositions,
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
 * - withPlaybackPositions: Playback position tracking
 *
 * @see docs/XTREAM_STORE_REFACTORING_PLAN.md
 */
export const XtreamStore = signalStore(
    { providedIn: 'root' },

    // Compose all features
    withPortal(),
    withContent(),
    withSelection(),
    withSearch(),
    withEpg(),
    withPlayer(),
    withFavorites(),
    withRecentItems(),
    withPlaybackPositions(),

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
        const xtreamApiService = inject(XtreamApiService);
        const ngrxStore = inject(Store);
        const searchContent = (store as any)
            .searchContent as (term: string, types: string[], excludeHidden?: boolean) => Promise<unknown>;

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
                const playlist = store.currentPlaylist();
                if (playlist) {
                    store.loadAllPositions(playlist.id);
                }
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

                store.setIsLoadingDetails(true);
                xtreamApiService.getVodInfo({
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                }, params.vodId).then((vodDetails: XtreamVodDetails) => {
                    store.setSelectedCategory(params.categoryId);
                    store.setSelectedItem({
                        ...vodDetails,
                        stream_id: params.vodId,
                    });
                }).catch((error: unknown) => {
                    console.error('Error fetching VOD details:', error);
                }).finally(() => {
                    store.setIsLoadingDetails(false);
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

                store.setIsLoadingDetails(true);
                xtreamApiService.getSeriesInfo({
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                }, params.serialId).then((serialDetails: XtreamSerieDetails) => {
                    store.setSelectedCategory(params.categoryId);
                    store.setSelectedItem({
                        ...serialDetails,
                        series_id: params.serialId,
                    });
                }).catch((error: unknown) => {
                    console.error('Error fetching series details:', error);
                }).finally(() => {
                    store.setIsLoadingDetails(false);
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
             * Can be called with object { term, types, excludeHidden } or direct params
             */
            searchContent(params: { term: string; types: string[]; excludeHidden?: boolean }): void {
                // Call the underlying search method from withSearch
                void searchContent(params.term, params.types, params.excludeHidden);
            },
        };
    })
);

// Type alias for the store
export type XtreamStoreType = InstanceType<typeof XtreamStore>;
