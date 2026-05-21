import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { createLogger } from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';

export const withFavorites = function () {
    const logger = createLogger('withFavorites');
    return signalStoreFeature(
        withState({
            isFavorite: false,
        }),
        withMethods((store, dataSource = inject(XTREAM_DATA_SOURCE)) => ({
            async toggleFavorite(
                xtreamId: number | string,
                playlistId: string,
                contentType: 'live' | 'movie' | 'series',
                backdropUrl?: string
            ) {
                const normalizedXtreamId = Number(xtreamId);
                if (
                    !Number.isFinite(normalizedXtreamId) ||
                    normalizedXtreamId <= 0 ||
                    !playlistId
                ) {
                    return false;
                }

                const content = await dataSource.getContentByXtreamId(
                    normalizedXtreamId,
                    playlistId,
                    contentType
                );
                const contentId =
                    content?.id ??
                    (!window.electron ? normalizedXtreamId : null);

                if (contentId == null) {
                    logger.error(
                        'Content not found for xtream ID',
                        normalizedXtreamId
                    );
                    return false;
                }

                const currentStatus = store.isFavorite();

                if (currentStatus) {
                    // Remove from favorites
                    await dataSource.removeFavorite(contentId, playlistId);
                    patchState(store, { isFavorite: false });
                    return false;
                } else {
                    // Add to favorites
                    await dataSource.addFavorite(
                        contentId,
                        playlistId,
                        backdropUrl
                    );
                    patchState(store, { isFavorite: true });
                    return true;
                }
            },

            async checkFavoriteStatus(
                xtreamId: number | string,
                playlistId: string,
                contentType: 'live' | 'movie' | 'series'
            ) {
                const normalizedXtreamId = Number(xtreamId);
                if (
                    !Number.isFinite(normalizedXtreamId) ||
                    normalizedXtreamId <= 0 ||
                    !playlistId
                ) {
                    patchState(store, { isFavorite: false });
                    return;
                }

                const content = await dataSource.getContentByXtreamId(
                    normalizedXtreamId,
                    playlistId,
                    contentType
                );
                const contentId =
                    content?.id ??
                    (!window.electron ? normalizedXtreamId : null);

                if (contentId == null) {
                    patchState(store, { isFavorite: false });
                    return;
                }

                const isFavorite = await dataSource.isFavorite(
                    contentId,
                    playlistId
                );

                patchState(store, { isFavorite });
            },
        }))
    );
};
