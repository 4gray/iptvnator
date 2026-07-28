import { computed, inject } from '@angular/core';
import { signalStore, withComputed, withMethods } from '@ngrx/signals';
import {
    XtreamSerieDetails,
    XtreamVodDetails,
} from '@iptvnator/shared/interfaces';

import { withFavorites } from '../with-favorites.feature';
import { withRecentItems } from '../with-recent-items';

import { XTREAM_DATA_SOURCE } from '../data-sources/xtream-data-source.interface';
import { XtreamApiService } from '../services/xtream-api.service';

import { TmdbEnrichmentService } from '@iptvnator/services';
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
import {
    enrichSerialSeasonWithTmdb,
    enrichSerialSelectionWithTmdb,
    enrichVodSelectionWithTmdb,
} from './xtream-tmdb-enrichment';
import {
    createXtreamDetailsRequestGuard,
    recoverXtreamVodCatalogItem,
} from './xtream-details-request';
import { resolveXtreamVodPlaybackSource } from '../services/xtream-vod-playback-source';
import {
    buildXtreamVodSelection,
    XtreamVodCatalogCategory,
} from './xtream-vod-selection';

/** Facade composing the Xtream feature stores and cross-feature workflows. */
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
        const tmdbEnrichment = inject(TmdbEnrichmentService);
        const logger = createLogger('XtreamStore');
        const detailsRequestGuard = createXtreamDetailsRequestGuard(
            () => store.currentPlaylist()?.id
        );
        const findVodCatalogItem = (vodId: string | number) =>
            store.vodStreams().find((item) => {
                const candidateId =
                    item.xtream_id ??
                    item.stream_id ??
                    (item as { id?: string | number }).id;

                return Number(candidateId) === Number(vodId);
            });
        return {
            cancelDetailsRequest(): void {
                detailsRequestGuard.invalidate();
                store.setIsLoadingDetails(false);
            },

            /**
             * Full store reset for switching between playlists
             */
            resetStore(newPlaylistId?: string): void {
                detailsRequestGuard.invalidate();
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
                const isCurrentRequest = detailsRequestGuard.begin(playlist.id);
                const credentials = {
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                };

                store.setIsLoadingDetails(true);
                store.setDetailsError(null);
                xtreamApiService
                    .getVodInfo(credentials, params.vodId)
                    .then(async (vodDetails: XtreamVodDetails) => {
                        if (!isCurrentRequest()) return;

                        let catalogItem = findVodCatalogItem(params.vodId);
                        let selection = buildXtreamVodSelection(
                            vodDetails,
                            catalogItem,
                            params.vodId
                        );

                        if (!resolveXtreamVodPlaybackSource(selection)) {
                            try {
                                const remoteCatalogItem =
                                    await recoverXtreamVodCatalogItem({
                                        apiService: xtreamApiService,
                                        currentCategories:
                                            store.vodCategories() as unknown as XtreamVodCatalogCategory[],
                                        credentials,
                                        dataSource,
                                        isCurrent: isCurrentRequest,
                                        playlistId: playlist.id,
                                        routeCategoryId: params.categoryId,
                                        vodId: params.vodId,
                                    });
                                if (remoteCatalogItem) {
                                    catalogItem = {
                                        ...catalogItem,
                                        ...remoteCatalogItem,
                                    };
                                    selection = buildXtreamVodSelection(
                                        vodDetails,
                                        catalogItem,
                                        params.vodId
                                    );
                                }
                            } catch (error) {
                                if (isCurrentRequest()) {
                                    logger.warn(
                                        'Failed to recover sparse VOD playback source from the catalog',
                                        error
                                    );
                                }
                            }
                        }

                        if (!isCurrentRequest()) return;
                        store.setSelectedCategory(params.categoryId);
                        store.setSelectedItem(selection);
                        void enrichVodSelectionWithTmdb(
                            store,
                            tmdbEnrichment,
                            params.vodId
                        );
                    })
                    .catch((error: unknown) => {
                        if (!isCurrentRequest()) return;
                        logger.error('Error fetching VOD details', error);
                        store.setDetailsError(
                            error instanceof Error
                                ? error.message
                                : 'Unknown error'
                        );
                    })
                    .finally(() => {
                        if (isCurrentRequest()) {
                            store.setIsLoadingDetails(false);
                        }
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
                const isCurrentRequest = detailsRequestGuard.begin(playlist.id);
                const credentials = {
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                };

                store.setIsLoadingDetails(true);
                store.setDetailsError(null);
                xtreamApiService
                    .getSeriesInfo(credentials, params.serialId)
                    .then((serialDetails: XtreamSerieDetails) => {
                        if (!isCurrentRequest()) return;
                        store.setSelectedCategory(params.categoryId);
                        store.setSelectedItem({
                            ...serialDetails,
                            series_id: params.serialId,
                        });
                        void enrichSerialSelectionWithTmdb(
                            store,
                            tmdbEnrichment,
                            params.serialId
                        );
                    })
                    .catch((error: unknown) => {
                        if (!isCurrentRequest()) return;
                        logger.error('Error fetching series details', error);
                        store.setDetailsError(
                            error instanceof Error
                                ? error.message
                                : 'Unknown error'
                        );
                    })
                    .finally(() => {
                        if (isCurrentRequest()) {
                            store.setIsLoadingDetails(false);
                        }
                    });
            },

            /**
             * Lazy TMDB enrichment of one season's episodes (real names,
             * overviews, stills). Fired by the detail view when the user
             * opens a season; a no-op without a show-level TMDB match.
             */
            enrichSelectedSerialSeason(seasonKey: string): void {
                void enrichSerialSeasonWithTmdb(
                    store,
                    tmdbEnrichment,
                    seasonKey
                );
            },
        };
    })
);

// Type alias for the store
export type XtreamStoreType = InstanceType<typeof XtreamStore>;
