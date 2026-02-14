import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withProps,
    withState,
} from '@ngrx/signals';
import { DataService, StalkerSessionService } from 'services';
import { Playlist, STALKER_REQUEST, StalkerPortalActions } from 'shared-interfaces';
import {
    StalkerVodSeriesEpisode,
    StalkerVodSeriesSeason,
} from '../../models';
import { sortEpisodesByNumber } from '../utils';
import { resource } from '@angular/core';
import { StalkerContentTypes } from '../../stalker-content-types';
import { sortByNumericValue, sortVodSeriesSeasonsByNumber } from '../utils';
import { createLogger } from '../../../shared/utils/logger';

/**
 * Regular-series and VOD-series feature state.
 */
export interface StalkerSeriesState {
    /** For VOD items that are actually series (Ministra plugin is_series=1) */
    vodSeriesSeasons: StalkerVodSeriesSeason[];
    vodSeriesEpisodes: StalkerVodSeriesEpisode[];
    selectedVodSeriesSeasonId: string | undefined;
}

const initialSeriesState: StalkerSeriesState = {
    vodSeriesSeasons: [],
    vodSeriesEpisodes: [],
    selectedVodSeriesSeasonId: undefined,
};

export function withStalkerSeries() {
    const logger = createLogger('withStalkerSeries');
    const toMovieId = (value: unknown): string => {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        return raw.includes(':') ? raw.split(':')[0] : raw;
    };
    return signalStoreFeature(
        withState<StalkerSeriesState>(initialSeriesState),
        withProps(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService)
            ) => ({
                serialSeasonsResource: resource({
                    params: () => ({
                        itemId: (store as any).selectedSerialId(),
                    }),
                    loader: async ({ params }) => {
                        const movieId = toMovieId(params.itemId);
                        // Guard: ensure currentPlaylist and itemId are available
                        if (!(store as any).currentPlaylist() || !movieId) {
                            return [];
                        }
                        const playlist = (store as any).currentPlaylist() as Playlist;
                        const queryParams = {
                            action: StalkerContentTypes.series.getContentAction,
                            type: 'series',
                            movie_id: movieId,
                        };

                        // Use makeAuthenticatedRequest for automatic retry on auth failure
                        let response: any;
                        if (playlist.isFullStalkerPortal) {
                            // Full stalker portal - use authenticated request with retry
                            response =
                                await stalkerSession.makeAuthenticatedRequest(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            // Simple stalker portal - no auth needed
                            response = await dataService.sendIpcEvent(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        // Guard: ensure response has expected structure
                        if (!response?.js?.data) {
                            logger.warn('Invalid seasons response', response);
                            return [];
                        }
                        return sortByNumericValue(response.js.data);
                    },
                }),
                /**
                 * Resource to fetch seasons for VOD items that are actually series (is_series=1)
                 * Used for Ministra plugin where VOD items can contain series/seasons
                 */
                vodSeriesSeasonsResource: resource({
                    params: () => ({
                        selectedItem: (store as any).selectedItem(),
                        selectedContentType:
                            (store as any).selectedContentType?.() ?? 'vod',
                    }),
                    loader: async ({
                        params,
                    }): Promise<StalkerVodSeriesSeason[]> => {
                        const item = params.selectedItem;
                        logger.debug('vodSeriesSeasonsResource loader called', {
                            item,
                            isSeries: item?.is_series,
                            currentPlaylist: (store as any).currentPlaylist(),
                        });

                        // Only fetch if item is a VOD series (has is_series flag)
                        if (
                            !(store as any).currentPlaylist() ||
                            params.selectedContentType !== 'vod' ||
                            !item ||
                            !item.is_series
                        ) {
                            logger.debug(
                                'vodSeriesSeasonsResource skipped - conditions not met'
                            );
                            return [];
                        }

                        const playlist = (store as any).currentPlaylist() as Playlist;
                        const queryParams = {
                            action: StalkerPortalActions.GetOrderedList,
                            type: 'vod',
                            movie_id: item.id,
                            p: '1',
                        };

                        let response: any;
                        if (playlist.isFullStalkerPortal) {
                            response =
                                await stalkerSession.makeAuthenticatedRequest(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            response = await dataService.sendIpcEvent(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        if (!response?.js?.data) {
                            logger.debug(
                                'vodSeriesSeasonsResource - no response data'
                            );
                            return [];
                        }

                        logger.debug(
                            'vodSeriesSeasonsResource response data',
                            response.js.data
                        );

                        // Filter for season items (is_season: true)
                        const seasons = response.js.data.filter(
                            (item: StalkerVodSeriesSeason) =>
                                item.is_season === true
                        );
                        logger.debug(
                            'vodSeriesSeasonsResource filtered seasons',
                            seasons
                        );
                        return sortVodSeriesSeasonsByNumber(seasons);
                    },
                }),
            })
        ),
        withComputed((store) => {
            const storeAny = store as any;
            return {
                /** serials */
                getSerialSeasonsResource: computed(() =>
                    storeAny.serialSeasonsResource.value()
                ),
                isSerialSeasonsLoading: computed(() =>
                    storeAny.serialSeasonsResource.isLoading()
                ),
                /** VOD series (Ministra plugin is_series=1) */
                getVodSeriesSeasonsResource: computed(() =>
                    storeAny.vodSeriesSeasonsResource.value()
                ),
                isVodSeriesSeasonsLoading: computed(() =>
                    storeAny.vodSeriesSeasonsResource.isLoading()
                ),
            };
        }),
        withMethods(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService)
            ) => {
                const storeAny = store as any;

                return {
                    /**
                     * Fetch episodes for a VOD series season (Ministra plugin)
                     * @param videoId The video_id from the season item
                     * @param seasonId The season id
                     * @returns Array of episode items
                     */
                    async fetchVodSeriesEpisodes(
                        videoId: string,
                        seasonId: string
                    ): Promise<StalkerVodSeriesEpisode[]> {
                        const playlist = storeAny.currentPlaylist() as Playlist;
                        if (!playlist) return [];

                        const queryParams = {
                            action: StalkerPortalActions.GetOrderedList,
                            type: 'vod',
                            movie_id: videoId,
                            season_id: seasonId,
                            p: '1',
                        };

                        let response: any;
                        if (playlist.isFullStalkerPortal) {
                            response =
                                await stalkerSession.makeAuthenticatedRequest(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            response = await dataService.sendIpcEvent(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        if (!response?.js?.data) {
                            return [];
                        }

                        // Filter for episode items (is_episode: true) and sort by series_number
                        const episodes = sortEpisodesByNumber(
                            response.js.data.filter(
                                (item: StalkerVodSeriesEpisode) =>
                                    item.is_episode === true
                            )
                        );

                        // Store episodes and selected season
                        patchState(store, {
                            vodSeriesEpisodes: episodes,
                            selectedVodSeriesSeasonId: seasonId,
                        });

                        return episodes;
                    },
                };
            }
        )
    );
}
