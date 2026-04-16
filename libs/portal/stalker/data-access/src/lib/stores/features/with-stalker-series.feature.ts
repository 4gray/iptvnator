import { computed, inject, resource } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withProps,
    withState,
} from '@ngrx/signals';
import { createLogger } from '@iptvnator/portal/shared/util';
import { DataService } from 'services';
import { StalkerPortalActions } from 'shared-interfaces';
import {
    StalkerSeason,
    StalkerVodSeriesEpisode,
    StalkerVodSeriesSeason,
} from '../../models';
import { StalkerContentTypes } from '../../stalker-content-types';
import { StalkerSessionService } from '../../stalker-session.service';
import { StalkerSeriesFeatureStoreContract } from '../stalker-store.contracts';
import {
    executeStalkerRequest,
    sortByNumericValue,
    sortEpisodesByNumber,
    sortVodSeriesSeasonsByNumber,
} from '../utils';

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

interface StalkerSeriesResponse<T> {
    js?:
        | {
              data?: T[];
          }
        | T[];
}

type StalkerSeriesStoreContext = StalkerSeriesFeatureStoreContract;

function extractSeriesItems<T>(response: StalkerSeriesResponse<T>): T[] {
    if (Array.isArray(response?.js)) {
        return response.js;
    }

    if (Array.isArray(response?.js?.data)) {
        return response.js.data;
    }

    return [];
}

function toMovieId(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return '';
    }

    return raw.includes(':') ? raw.split(':')[0] : raw;
}

export function withStalkerSeries() {
    const logger = createLogger('withStalkerSeries');

    return signalStoreFeature(
        withState<StalkerSeriesState>(initialSeriesState),
        withProps(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService)
            ) => {
                const storeContext = store as typeof store &
                    StalkerSeriesStoreContext;
                const requestDeps = {
                    dataService,
                    stalkerSession,
                };

                return {
                    serialSeasonsResource: resource({
                        params: () => ({
                            itemId: storeContext.selectedSerialId(),
                            currentPlaylist: storeContext.currentPlaylist(),
                        }),
                        loader: async ({
                            params,
                        }): Promise<StalkerSeason[]> => {
                            const playlist = params.currentPlaylist;
                            const movieId = toMovieId(params.itemId);

                            if (!playlist || !movieId) {
                                return [];
                            }

                            const response = await executeStalkerRequest<
                                StalkerSeriesResponse<StalkerSeason>
                            >(requestDeps, playlist, {
                                action: StalkerContentTypes.series
                                    .getContentAction,
                                type: 'series',
                                movie_id: movieId,
                            });

                            const seasons = extractSeriesItems(response);

                            if (seasons.length === 0) {
                                logger.warn(
                                    'Invalid seasons response',
                                    response
                                );
                                return [];
                            }

                            return sortByNumericValue(seasons);
                        },
                    }),
                    vodSeriesSeasonsResource: resource({
                        params: () => ({
                            currentPlaylist: storeContext.currentPlaylist(),
                            selectedItem: storeContext.selectedItem(),
                            selectedContentType:
                                storeContext.selectedContentType(),
                        }),
                        loader: async ({
                            params,
                        }): Promise<StalkerVodSeriesSeason[]> => {
                            const { currentPlaylist, selectedItem } = params;

                            logger.debug(
                                'vodSeriesSeasonsResource loader called',
                                {
                                    item: selectedItem,
                                    isSeries: selectedItem?.is_series,
                                    currentPlaylist,
                                }
                            );

                            if (
                                !currentPlaylist ||
                                params.selectedContentType !== 'vod' ||
                                !selectedItem ||
                                selectedItem.id === undefined ||
                                selectedItem.id === null ||
                                !selectedItem.is_series
                            ) {
                                logger.debug(
                                    'vodSeriesSeasonsResource skipped - conditions not met'
                                );
                                return [];
                            }

                            const response = await executeStalkerRequest<
                                StalkerSeriesResponse<StalkerVodSeriesSeason>
                            >(requestDeps, currentPlaylist, {
                                action: StalkerPortalActions.GetOrderedList,
                                type: 'vod',
                                movie_id: selectedItem.id,
                                p: '1',
                            });

                            const seasonItems = extractSeriesItems(response);
                            if (seasonItems.length === 0) {
                                logger.debug(
                                    'vodSeriesSeasonsResource - no response data'
                                );
                                return [];
                            }

                            logger.debug(
                                'vodSeriesSeasonsResource response data',
                                seasonItems
                            );

                            const seasons = seasonItems.filter(
                                (item) => item.is_season === true
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
            const storeContext = store as typeof store &
                StalkerSeriesStoreContext;

            return {
                getSerialSeasonsResource: computed(() =>
                    storeContext.serialSeasonsResource.value()
                ),
                isSerialSeasonsLoading: computed(() =>
                    storeContext.serialSeasonsResource.isLoading()
                ),
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
                const storeContext = store as typeof store &
                    Pick<StalkerSeriesStoreContext, 'currentPlaylist'>;
                const requestDeps = {
                    dataService,
                    stalkerSession,
                };

                return {
                    async fetchVodSeriesEpisodes(
                        videoId: string,
                        seasonId: string
                    ): Promise<StalkerVodSeriesEpisode[]> {
                        const playlist = storeContext.currentPlaylist();
                        if (!playlist) {
                            return [];
                        }

                        const response = await executeStalkerRequest<
                            StalkerSeriesResponse<StalkerVodSeriesEpisode>
                        >(requestDeps, playlist, {
                            action: StalkerPortalActions.GetOrderedList,
                            type: 'vod',
                            movie_id: videoId,
                            season_id: seasonId,
                            p: '1',
                        });

                        const episodeItems = extractSeriesItems(response);
                        if (episodeItems.length === 0) {
                            return [];
                        }

                        const episodes = sortEpisodesByNumber(
                            episodeItems.filter(
                                (item) => item.is_episode === true
                            )
                        );

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
