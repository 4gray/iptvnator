import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { XTREAM_FAVORITE_IDENTITY_CONFLICT } from '@iptvnator/shared/interfaces';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';

export const withFavorites = function () {
    const logger = createLogger('withFavorites');
    return signalStoreFeature(
        withState({
            isFavorite: false,
        }),
        withMethods(
            (
                store,
                dataSource = inject(XTREAM_DATA_SOURCE),
                runtime = inject(RuntimeCapabilitiesService),
                snackBar = inject(MatSnackBar),
                translate = inject(TranslateService)
            ) => ({
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
                        (!runtime.supportsXtreamSqliteDataSource
                            ? normalizedXtreamId
                            : null);

                    if (contentId == null) {
                        logger.error(
                            'Content not found for xtream ID',
                            normalizedXtreamId
                        );
                        return false;
                    }

                    const currentStatus = await dataSource.isFavorite(
                        { id: contentId, type: contentType },
                        playlistId
                    );

                    if (currentStatus) {
                        // Remove from favorites
                        await dataSource.removeFavorite(
                            { id: contentId, type: contentType },
                            playlistId
                        );
                        patchState(store, { isFavorite: false });
                        return false;
                    } else {
                        // Add to favorites
                        try {
                            await dataSource.addFavorite(
                                { id: contentId, type: contentType },
                                playlistId,
                                backdropUrl
                            );
                        } catch (error) {
                            patchState(store, { isFavorite: false });
                            const key =
                                error instanceof Error &&
                                error.message ===
                                    XTREAM_FAVORITE_IDENTITY_CONFLICT
                                    ? 'PORTALS.FAVORITE_IDENTITY_CONFLICT'
                                    : 'PORTALS.FAVORITE_SAVE_FAILED';
                            snackBar.open(translate.instant(key), undefined, {
                                duration: 6000,
                            });
                            return false;
                        }
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
                        (!runtime.supportsXtreamSqliteDataSource
                            ? normalizedXtreamId
                            : null);

                    if (contentId == null) {
                        patchState(store, { isFavorite: false });
                        return;
                    }

                    const isFavorite = await dataSource.isFavorite(
                        { id: contentId, type: contentType },
                        playlistId
                    );

                    patchState(store, { isFavorite });
                },
            })
        )
    );
};
