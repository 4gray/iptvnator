import { observeActivityChanges } from '@iptvnator/services/activity-changes';
import { DestroyRef } from '@angular/core';
import { computed, inject } from '@angular/core';
import {
    signalStore,
    withComputed,
    withMethods,
    withHooks,
} from '@ngrx/signals';
import {
    XtreamSerieDetails,
    XtreamVodDetails,
} from '@iptvnator/shared/interfaces';

import { withFavorites } from '../with-favorites.feature';
import { withRecentItems } from '../with-recent-items';

import { XTREAM_DATA_SOURCE } from '../data-sources/xtream-data-source.interface';
import { XtreamApiService } from '../services/xtream-api.service';

import { TmdbEnrichmentService } from '@iptvnator/services';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import {
    withContent,
    withEpg,
    withPlaybackPositions,
    withPlayer,
    withPortal,
    withSearch,
    withSelection,
    tmdbSeasonMetadataKey,
    tmdbShowMetadataKey,
    withTmdbEpisodeMetadata,
} from './features';

import {
    applyRecoveredXtreamVodCatalogItem,
    createXtreamDetailsRequestGuard,
    resolveXtreamVodDetailsSelection,
} from './xtream-details-request';
import { stripXtreamSerieInfoPlaceholders } from './xtream-detail-metadata';

/** Facade composing the Xtream feature stores and cross-feature workflows. */
export const XtreamStore = signalStore(
    { providedIn: 'root' },

    // Compose all features
    withPortal(),
    withContent(),
    withPlaybackPositions(),
    withSelection(),
    withSearch(),
    withEpg(),
    withPlayer(),
    withFavorites(),
    withRecentItems(),
    withTmdbEpisodeMetadata(),

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
        const enrichDetails = (
            isCurrent: () => boolean,
            enrich: (
                helpers: typeof import('./xtream-tmdb-enrichment')
            ) => Promise<void>
        ): Promise<void> =>
            import('./xtream-tmdb-enrichment')
                .then((helpers) => (isCurrent() ? enrich(helpers) : undefined))
                .catch((error) => logger.warn('TMDB unavailable', error));
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
                store.resetPlaybackPositions();
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
                    void store.loadAllPositions(playlist.id).catch((error) => {
                        logger.warn('Failed to load playback positions', error);
                    });
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
                    userAgent: playlist.userAgent?.trim() || undefined,
                };

                store.setIsLoadingDetails(true);
                store.setDetailsError(null);
                store.setSelectedItem(null);
                xtreamApiService
                    .getVodInfo(credentials, params.vodId)
                    .then((vodDetails: XtreamVodDetails) => {
                        if (!isCurrentRequest()) return;

                        const { recovery, selection } =
                            resolveXtreamVodDetailsSelection({
                                apiService: xtreamApiService,
                                currentCategories: store.vodCategories(),
                                currentCategoriesPlaylistId:
                                    store.vodCategoriesPlaylistId(),
                                currentStreams: store.vodStreams(),
                                currentStreamsPlaylistId:
                                    store.vodStreamsPlaylistId(),
                                credentials,
                                dataSource,
                                isCurrent: isCurrentRequest,
                                playlistId: playlist.id,
                                routeCategoryId: params.categoryId,
                                vodDetails,
                                vodId: params.vodId,
                            });
                        if (!isCurrentRequest()) return;
                        store.setSelectedCategory(params.categoryId);
                        store.setSelectedItem(selection);
                        void enrichDetails(isCurrentRequest, (helpers) =>
                            helpers.enrichVodSelectionWithTmdb(
                                store,
                                tmdbEnrichment,
                                params.vodId,
                                isCurrentRequest
                            )
                        );

                        if (!recovery) {
                            return;
                        }

                        void recovery.then(
                            ({ recoveredCatalogItem, recoveryError }) => {
                                if (!isCurrentRequest()) {
                                    return;
                                }
                                if (recoveryError) {
                                    logger.warn(
                                        'Failed to recover sparse VOD playback source from the catalog',
                                        recoveryError
                                    );
                                    return;
                                }
                                if (!recoveredCatalogItem) {
                                    return;
                                }

                                const recoveredSelection =
                                    applyRecoveredXtreamVodCatalogItem(
                                        store.selectedItem(),
                                        recoveredCatalogItem,
                                        params.vodId
                                    );
                                if (recoveredSelection) {
                                    store.setSelectedItem(recoveredSelection);
                                }
                            }
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
                    userAgent: playlist.userAgent?.trim() || undefined,
                };

                store.setIsLoadingDetails(true);
                store.setDetailsError(null);
                store.setSelectedItem(null);
                xtreamApiService
                    .getSeriesInfo(credentials, params.serialId)
                    .then((serialDetails: XtreamSerieDetails) => {
                        if (!isCurrentRequest()) return;
                        store.setSelectedCategory(params.categoryId);
                        store.setSelectedItem({
                            ...serialDetails,
                            info: stripXtreamSerieInfoPlaceholders(
                                serialDetails?.info
                            ),
                            series_id: params.serialId,
                        });
                        store.resetTmdbSeasonMetadata(params.serialId);
                        void store.trackTmdbEpisodeMetadata(
                            tmdbShowMetadataKey(params.serialId),
                            enrichDetails(isCurrentRequest, (helpers) =>
                                helpers.enrichSerialSelectionWithTmdb(
                                    store,
                                    tmdbEnrichment,
                                    params.serialId,
                                    isCurrentRequest
                                )
                            )
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
                const playlistId = store.currentPlaylist()?.id;
                if (!playlistId) {
                    return;
                }
                const seriesId = (
                    store.selectedItem() as { series_id?: string | number }
                )?.series_id;
                const isCurrent = () =>
                    store.currentPlaylist()?.id === playlistId &&
                    String(store.selectedItem()?.series_id) ===
                        String(seriesId);
                const work = enrichDetails(isCurrent, (helpers) =>
                    helpers.enrichSerialSeasonWithTmdb(
                        store,
                        tmdbEnrichment,
                        seasonKey,
                        isCurrent
                    )
                );
                void (seriesId === undefined
                    ? work
                    : store.trackTmdbEpisodeMetadata(
                          tmdbSeasonMetadataKey(seriesId, seasonKey),
                          work,
                          { keepSettled: true }
                      ));
            },

            /**
             * True while a TMDB lookup that could still fill the selected
             * series' `seasonKey` episodes is outstanding: the show-level
             * match, or — once matched — that season's episode enrichment
             * not yet settled. False with TMDB off or without a match.
             */
            isTmdbEpisodeMetadataPending(seasonKey: string): boolean {
                const item = store.selectedItem() as {
                    series_id?: string | number;
                    info?: { tmdb_id?: number | null } | unknown[];
                } | null;
                const seriesId = item?.series_id;
                if (seriesId === undefined || !tmdbEnrichment.isEnabled()) {
                    return false;
                }
                const status = store.tmdbEpisodeMetadata();
                if (status[tmdbShowMetadataKey(seriesId)] === 'pending') {
                    return true;
                }
                const info = item?.info;
                if (!info || Array.isArray(info) || !info.tmdb_id) {
                    return false;
                }
                return (
                    status[tmdbSeasonMetadataKey(seriesId, seasonKey)] !==
                    'settled'
                );
            },
        };
    }),
    withHooks((store) => ({
        onInit() {
            inject(DestroyRef).onDestroy(
                observeActivityChanges(() => {
                    const id = store.currentPlaylist()?.id;
                    if (id)
                        void store.loadAllPositions(id).catch(() => undefined);
                })
            );
        },
    }))
);

// Type alias for the store
export type XtreamStoreType = InstanceType<typeof XtreamStore>;
