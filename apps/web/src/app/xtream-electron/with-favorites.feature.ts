import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { DatabaseService } from 'services';
import { FavoritesService } from './services/favorites.service';
import { createLogger } from '../shared/utils/logger';

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
                async toggleFavorite(xtreamId: number, playlistId: string) {
                    if (!xtreamId || !playlistId) {
                        return false;
                    }

                    // Get content by xtream ID
                    const content = await dbService.getContentByXtreamId(
                        xtreamId,
                        playlistId
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
                        });
                        patchState(store, { isFavorite: true });
                        return true;
                    }
                },

                async checkFavoriteStatus(
                    xtreamId: number,
                    playlistId: string
                ) {
                    if (!xtreamId || !playlistId) {
                        patchState(store, { isFavorite: false });
                        return;
                    }

                    // Get content by xtream ID
                    const content = await dbService.getContentByXtreamId(
                        xtreamId,
                        playlistId
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
