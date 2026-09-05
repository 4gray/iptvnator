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
import { DataService } from '@iptvnator/services';
import { StalkerPortalActions } from '@iptvnator/shared/interfaces';
import {
    StalkerSeason,
    StalkerVodSeriesEpisode,
    StalkerVodSeriesSeason,
} from '../../models';
import { StalkerContentTypes } from '../../stalker-content-types';
import { StalkerPortalRepairService } from '../../stalker-portal-repair.service';
import { StalkerSessionService } from '../../stalker-session.service';
import { isStalkerSeriesFlag } from '../../stalker-vod.utils';
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

/**
 * Strict variant: null when the envelope carried no array at all, so a
 * malformed answer is distinguishable from a well-formed empty list. The
 * series watched toggle treats an answered-empty season as loaded, so a
 * malformed envelope collapsing to [] would silently skip that season.
 */
function extractSeriesItemsStrict<T>(
    response: StalkerSeriesResponse<T>
): T[] | null {
    if (Array.isArray(response?.js)) {
        return response.js;
    }

    if (Array.isArray(response?.js?.data)) {
        return response.js.data;
    }

    return null;
}

function extractSeriesItems<T>(response: StalkerSeriesResponse<T>): T[] {
    return extractSeriesItemsStrict(response) ?? [];
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
                stalkerSession = inject(StalkerSessionService),
                portalRepair = inject(StalkerPortalRepairService)
            ) => {
                const storeContext = store as typeof store &
                    StalkerSeriesStoreContext;
                // Enrichment patches selectedItem in place. Only provider
                // identity/mode changes should reload seasons and reset episodes.
                const vodSeriesMovieId = computed(() => {
                    const item = storeContext.selectedItem();
                    return storeContext.selectedContentType() === 'vod' &&
                        isStalkerSeriesFlag(item?.is_series) &&
                        item?.id != null
                        ? String(item.id)
                        : null;
                });
                const requestDeps = {
                    dataService,
                    stalkerSession,
                    portalRepair,
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
                            movieId: vodSeriesMovieId(),
                        }),
                        loader: async ({
                            params,
                        }): Promise<StalkerVodSeriesSeason[]> => {
                            const { currentPlaylist, movieId } = params;

                            if (!currentPlaylist || movieId === null) {
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
                                movie_id: movieId,
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
                stalkerSession = inject(StalkerSessionService),
                portalRepair = inject(StalkerPortalRepairService)
            ) => {
                const storeContext = store as typeof store &
                    Pick<StalkerSeriesStoreContext, 'currentPlaylist'>;
                const requestDeps = {
                    dataService,
                    stalkerSession,
                    portalRepair,
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

                        // Only a well-formed empty array is a trusted empty
                        // season. A malformed envelope, or rows in which no
                        // episode is recognizable, rejects so callers treat
                        // the load as failed instead of loaded-and-empty.
                        const episodeItems = extractSeriesItemsStrict(response);
                        if (episodeItems === null) {
                            throw new Error(
                                'Malformed Stalker season episodes response'
                            );
                        }
                        if (episodeItems.length === 0) {
                            return [];
                        }

                        const episodes = sortEpisodesByNumber(
                            episodeItems.filter(
                                (item) => item.is_episode === true
                            )
                        );
                        if (episodes.length === 0) {
                            throw new Error(
                                'Stalker season answered without recognizable episodes'
                            );
                        }

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
