import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { DatabaseService } from '@iptvnator/services';
import { FavoritesService } from './services/favorites.service';
import { createLogger } from '@iptvnator/portal/shared/util';

export const withFavorites = function () {
    const logger = createLogger('withFavorites');
    return signalStoreFeature(
        withState({
            isFavorite: false,
        }),
        withMethods(
            (
                store,
                dbService = inject(DatabaseService),
                favoritesService = inject(FavoritesService)
            ) => ({
                async toggleFavorite(
                    xtreamId: number,
                    playlistId: string,
                    contentType: 'live' | 'movie' | 'series',
                    backdropUrl?: string
                ) {
                    if (!xtreamId || !playlistId) {
                        return false;
                    }

                    const content = await dbService.getContentByXtreamId(
                        xtreamId,
                        playlistId,
                        contentType
                    );
                    if (!content) {
                        logger.error(
                            'Content not found for xtream ID',
                            xtreamId
                        );
                        return false;
                    }

                    const currentStatus = store.isFavorite();

                    if (currentStatus) {
                        // Remove from favorites
                        await favoritesService.removeFromFavorites(
                            content.id,
                            playlistId
                        );
                        patchState(store, { isFavorite: false });
                        return false;
                    } else {
                        // Add to favorites
                        await favoritesService.addToFavorites({
                            content_id: content.id,
                            playlist_id: playlistId,
                            backdrop_url: backdropUrl,
                        });
                        patchState(store, { isFavorite: true });
                        return true;
                    }
                },

                async checkFavoriteStatus(
                    xtreamId: number,
                    playlistId: string,
                    contentType: 'live' | 'movie' | 'series'
                ) {
                    if (!xtreamId || !playlistId) {
                        patchState(store, { isFavorite: false });
                        return;
                    }

                    const content = await dbService.getContentByXtreamId(
                        xtreamId,
                        playlistId,
                        contentType
                    );
                    if (!content) {
                        patchState(store, { isFavorite: false });
                        return;
                    }

                    const isFavorite = await favoritesService.isFavorite(
                        content.id,
                        playlistId
                    );

                    patchState(store, { isFavorite });
                },
            })
        )
    );
};
