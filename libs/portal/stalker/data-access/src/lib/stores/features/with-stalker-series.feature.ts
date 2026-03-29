import { computed, inject, resource } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withProps,
    withState,
} from '@ngrx/signals';
import { DataService } from 'services';
import { Playlist, STALKER_REQUEST, StalkerPortalActions } from 'shared-interfaces';
import {
    StalkerSeason,
    StalkerVodSource,
    StalkerVodSeriesEpisode,
    StalkerVodSeriesSeason,
} from '../../models';
import { StalkerSessionService } from '../../stalker-session.service';
import { StalkerContentTypes } from '../../stalker-content-types';
import {
    sortByNumericValue,
    sortEpisodesByNumber,
    sortVodSeriesSeasonsByNumber,
} from '../utils';
import { createLogger } from '@iptvnator/portal/shared/util';

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

interface ResourceState<T> {
    value(): T;
    isLoading(): boolean;
}

interface StalkerSeriesResponse<T> {
    js?:
        | {
              data?: T[];
          }
        | T[];
}

interface StalkerSeriesStoreContext {
    selectedSerialId(): string | undefined;
    currentPlaylist(): Playlist | undefined;
    selectedItem(): StalkerVodSource | null | undefined;
    selectedContentType(): 'vod' | 'series' | 'itv';
    serialSeasonsResource: ResourceState<StalkerSeason[]>;
    vodSeriesSeasonsResource: ResourceState<StalkerVodSeriesSeason[]>;
}

function extractSeriesItems<T>(response: StalkerSeriesResponse<T>): T[] {
    if (Array.isArray(response?.js)) {
        return response.js;
    }

    if (Array.isArray(response?.js?.data)) {
        return response.js.data;
    }

    return [];
}

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
            ) => {
                const storeContext =
                    store as unknown as StalkerSeriesStoreContext;

                return {
                    serialSeasonsResource: resource({
                    params: () => ({
                        itemId: storeContext.selectedSerialId(),
                    }),
                    loader: async ({ params }): Promise<StalkerSeason[]> => {
                        const movieId = toMovieId(params.itemId);
                        // Guard: ensure currentPlaylist and itemId are available
                        if (!storeContext.currentPlaylist() || !movieId) {
                            return [];
                        }
                        const playlist = storeContext.currentPlaylist() as Playlist;
                        const queryParams = {
                            action: StalkerContentTypes.series.getContentAction,
                            type: 'series',
                            movie_id: movieId,
                        };

                        // Use makeAuthenticatedRequest for automatic retry on auth failure
                        let response: StalkerSeriesResponse<StalkerSeason>;
                        if (playlist.isFullStalkerPortal) {
                            // Full stalker portal - use authenticated request with retry
                            response = await stalkerSession.makeAuthenticatedRequest<StalkerSeriesResponse<StalkerSeason>>(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            // Simple stalker portal - no auth needed
                            response = await dataService.sendIpcEvent<StalkerSeriesResponse<StalkerSeason>>(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        const seasons = extractSeriesItems(response);

                        if (seasons.length === 0) {
                            logger.warn('Invalid seasons response', response);
                            return [];
                        }

                        return sortByNumericValue(seasons);
                    },
                }),
                /**
                 * Resource to fetch seasons for VOD items that are actually series (is_series=1)
                 * Used for Ministra plugin where VOD items can contain series/seasons
                 */
                vodSeriesSeasonsResource: resource({
                    params: () => ({
                        selectedItem: storeContext.selectedItem(),
                        selectedContentType: storeContext.selectedContentType(),
                    }),
                    loader: async ({
                        params,
                    }): Promise<StalkerVodSeriesSeason[]> => {
                        const item = params.selectedItem;
                        logger.debug('vodSeriesSeasonsResource loader called', {
                            item,
                            isSeries: item?.is_series,
                            currentPlaylist: storeContext.currentPlaylist(),
                        });

                        // Only fetch if item is a VOD series (has is_series flag)
                        if (
                            !storeContext.currentPlaylist() ||
                            params.selectedContentType !== 'vod' ||
                            !item ||
                            !item.is_series
                        ) {
                            logger.debug(
                                'vodSeriesSeasonsResource skipped - conditions not met'
                            );
                            return [];
                        }

                        const playlist = storeContext.currentPlaylist() as Playlist;
                        const queryParams = {
                            action: StalkerPortalActions.GetOrderedList,
                            type: 'vod',
                            movie_id: item.id,
                            p: '1',
                        };

                        let response: StalkerSeriesResponse<StalkerVodSeriesSeason>;
                        if (playlist.isFullStalkerPortal) {
                            response = await stalkerSession.makeAuthenticatedRequest<StalkerSeriesResponse<StalkerVodSeriesSeason>>(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            response = await dataService.sendIpcEvent<StalkerSeriesResponse<StalkerVodSeriesSeason>>(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        const seasonItems = extractSeriesItems(response);

                        if (seasonItems.length === 0) {
                            logger.debug(
                                'vodSeriesSeasonsResource - no response data'
                            );
                            return [];
                        }

                        logger.debug('vodSeriesSeasonsResource response data', seasonItems);

                        // Filter for season items (is_season: true)
                        const seasons = seasonItems.filter(
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
                };
            }
        ),
        withComputed((store) => {
            const storeContext = store as unknown as StalkerSeriesStoreContext;
            return {
                /** serials */
                getSerialSeasonsResource: computed(() =>
                    storeContext.serialSeasonsResource.value()
                ),
                isSerialSeasonsLoading: computed(() =>
                    storeContext.serialSeasonsResource.isLoading()
                ),
                /** VOD series (Ministra plugin is_series=1) */
                getVodSeriesSeasonsResource: computed(() =>
                    storeContext.vodSeriesSeasonsResource.value()
                ),
                isVodSeriesSeasonsLoading: computed(() =>
                    storeContext.vodSeriesSeasonsResource.isLoading()
                ),
            };
        }),
        withMethods(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService)
            ) => {
                const storeContext =
                    store as unknown as Pick<
                        StalkerSeriesStoreContext,
                        'currentPlaylist'
                    >;

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
                        const playlist = storeContext.currentPlaylist() as Playlist;
                        if (!playlist) return [];

                        const queryParams = {
                            action: StalkerPortalActions.GetOrderedList,
                            type: 'vod',
                            movie_id: videoId,
                            season_id: seasonId,
                            p: '1',
                        };

                        let response: StalkerSeriesResponse<StalkerVodSeriesEpisode>;
                        if (playlist.isFullStalkerPortal) {
                            response = await stalkerSession.makeAuthenticatedRequest<StalkerSeriesResponse<StalkerVodSeriesEpisode>>(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            response = await dataService.sendIpcEvent<StalkerSeriesResponse<StalkerVodSeriesEpisode>>(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        const episodeItems = extractSeriesItems(response);

                        if (episodeItems.length === 0) {
                            return [];
                        }

                        // Filter for episode items (is_episode: true) and sort by series_number
                        const episodes = sortEpisodesByNumber(
                            episodeItems.filter(
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
