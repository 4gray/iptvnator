import { computed, inject } from '@angular/core';
import { signalStore, withComputed, withMethods } from '@ngrx/signals';
import { XtreamSerieDetails, XtreamVodDetails } from '@iptvnator/shared/interfaces';

// Import existing features that are already separate
import { withFavorites } from '../with-favorites.feature';
import { withRecentItems } from '../with-recent-items';

// Import service
import { XTREAM_DATA_SOURCE } from '../data-sources/xtream-data-source.interface';
import { XtreamApiService } from '../services/xtream-api.service';

// Import new feature stores
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    withContent,
    withEpg,
    withPlaybackPositions,
    withPlayer,
    withPortal,
    withSearch,
    withSelection,
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
    })),

    // Cross-feature methods & orchestration
    withMethods((store) => {
        const xtreamApiService = inject(XtreamApiService);
        const dataSource = inject(XTREAM_DATA_SOURCE);
        const logger = createLogger('XtreamStore');
        const findVodCatalogItem = (vodId: string | number) =>
            store.vodStreams().find((item) => {
                const candidateId =
                    item.xtream_id ??
                    item.stream_id ??
                    (item as { id?: string | number }).id;

                return Number(candidateId) === Number(vodId);
            });

        return {
            /**
             * Full store reset for switching between playlists
             */
            resetStore(newPlaylistId?: string): void {
                // Clear the session cache for the playlist we're leaving so
                // stale data cannot bleed into the new playlist (PWA path).
                const leavingPlaylistId = store.playlistId();
                const preserveCancelledBlock =
                    Boolean(newPlaylistId) &&
                    leavingPlaylistId === newPlaylistId &&
                    store.contentInitBlockReason() === 'cancelled';
                if (leavingPlaylistId) {
                    dataSource.clearSessionCache(leavingPlaylistId);
                }

                store.resetPortal();
                store.resetContent();
                store.resetSelection();
                store.resetSearchResults();
                store.clearEpg();
                store.resetPlayer();

                if (newPlaylistId) {
                    store.setPlaylistId(newPlaylistId);
                }

                if (preserveCancelledBlock) {
                    store.setContentInitBlockReason('cancelled');
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
            fetchVodDetailsWithMetadata(params: {
                vodId: string;
                categoryId: number;
            }): void {
                const playlist = store.currentPlaylist();
                if (!playlist) return;

                store.setIsLoadingDetails(true);
                store.setDetailsError(null);
                xtreamApiService
                    .getVodInfo(
                        {
                            serverUrl: playlist.serverUrl,
                            username: playlist.username,
                            password: playlist.password,
                        },
                        params.vodId
                    )
                    .then((vodDetails: XtreamVodDetails) => {
                        const catalogItem = findVodCatalogItem(params.vodId);

                        store.setSelectedCategory(params.categoryId);
                        store.setSelectedItem({
                            ...catalogItem,
                            ...vodDetails,
                            stream_id: params.vodId,
                            xtream_id:
                                catalogItem?.xtream_id ?? Number(params.vodId),
                        });
                    })
                    .catch((error: unknown) => {
                        logger.error('Error fetching VOD details', error);
                        store.setDetailsError(
                            error instanceof Error
                                ? error.message
                                : 'Unknown error'
                        );
                    })
                    .finally(() => {
                        store.setIsLoadingDetails(false);
                    });
            },

            /**
             * Fetch series details with metadata
             * Accepts object format for backward compatibility with rxMethod callers
             */
            fetchSerialDetailsWithMetadata(params: {
                serialId: string;
                categoryId: number;
            }): void {
                const playlist = store.currentPlaylist();
                if (!playlist) return;

                store.setIsLoadingDetails(true);
                store.setDetailsError(null);
                xtreamApiService
                    .getSeriesInfo(
                        {
                            serverUrl: playlist.serverUrl,
                            username: playlist.username,
                            password: playlist.password,
                        },
                        params.serialId
                    )
                    .then((serialDetails: XtreamSerieDetails) => {
                        store.setSelectedCategory(params.categoryId);
                        store.setSelectedItem({
                            ...serialDetails,
                            series_id: params.serialId,
                        });
                    })
                    .catch((error: unknown) => {
                        logger.error('Error fetching series details', error);
                        store.setDetailsError(
                            error instanceof Error
                                ? error.message
                                : 'Unknown error'
                        );
                    })
                    .finally(() => {
                        store.setIsLoadingDetails(false);
                    });
            },
        };
    })
);

// Type alias for the store
export type XtreamStoreType = InstanceType<typeof XtreamStore>;
