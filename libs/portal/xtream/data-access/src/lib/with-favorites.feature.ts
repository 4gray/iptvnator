import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
    type ContentMetadataPatch,
    normalizeContentMetadataPatch,
    XTREAM_FAVORITE_IDENTITY_CONFLICT,
} from '@iptvnator/shared/interfaces';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';

const favoriteTargetKey = (
    playlistId: string,
    type: string,
    id: number,
    identity?: ContentMetadataPatch
) => {
    const patch = identity ? normalizeContentMetadataPatch(identity) : null;
    return `${playlistId}:${type}:${id}:${patch?.tmdbId ?? ''}:${patch?.releaseYear ?? ''}`;
};

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
                // The store exists from startup: a static MatSnackBar import
                // would put Material's snack-bar and button on the initial path.
                snackBar = inject(LazySnackBar),
                translate = inject(TranslateService)
            ) => {
                let request = 0;
                let activeTarget = '';
                const publish = (owner: number, isFavorite: boolean) => {
                    if (owner === request) patchState(store, { isFavorite });
                };
                return {
                    async toggleFavorite(
                        xtreamId: number | string,
                        playlistId: string,
                        contentType: 'live' | 'movie' | 'series',
                        backdropUrl?: string,
                        identity?: ContentMetadataPatch
                    ) {
                        ++request;
                        const normalizedXtreamId = Number(xtreamId);
                        const targetKey = favoriteTargetKey(
                            playlistId,
                            contentType,
                            normalizedXtreamId,
                            identity
                        );
                        activeTarget = targetKey;
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
                            contentType,
                            ...(runtime.supportsXtreamSqliteDataSource &&
                            identity
                                ? [identity]
                                : [])
                        );
                        const contentId =
                            content?.id ??
                            (!runtime.supportsXtreamSqliteDataSource
                                ? normalizedXtreamId
                                : null);

                        if (contentId == null) {
                            // A typed identity filter can reject all existing copies.
                            // Preserve the conflict feedback without mutating a contrary row.
                            const candidate =
                                identity &&
                                runtime.supportsXtreamSqliteDataSource
                                    ? await dataSource.getContentByXtreamId(
                                          normalizedXtreamId,
                                          playlistId,
                                          contentType
                                      )
                                    : null;
                            if (candidate && activeTarget === targetKey) {
                                void snackBar.open(
                                    translate.instant(
                                        'PORTALS.FAVORITE_IDENTITY_CONFLICT'
                                    ),
                                    undefined,
                                    { duration: 6000 }
                                );
                            }
                            logger.error(
                                'Content not found for xtream ID',
                                normalizedXtreamId
                            );
                            return false;
                        }

                        const target = {
                            id: contentId,
                            type: contentType,
                            ...(!runtime.supportsXtreamSqliteDataSource &&
                            identity
                                ? { identity }
                                : {}),
                        };
                        const currentStatus = await dataSource.isFavorite(
                            target,
                            playlistId
                        );
                        let nextStatus = !currentStatus;
                        try {
                            if (currentStatus)
                                await dataSource.removeFavorite(
                                    target,
                                    playlistId
                                );
                            else
                                await dataSource.addFavorite(
                                    target,
                                    playlistId,
                                    backdropUrl
                                );
                        } catch (error) {
                            nextStatus = currentStatus;
                            if (activeTarget === targetKey) {
                                const key =
                                    error instanceof Error &&
                                    error.message ===
                                        XTREAM_FAVORITE_IDENTITY_CONFLICT
                                        ? 'PORTALS.FAVORITE_IDENTITY_CONFLICT'
                                        : 'PORTALS.FAVORITE_SAVE_FAILED';
                                void snackBar.open(
                                    translate.instant(key),
                                    undefined,
                                    { duration: 6000 }
                                );
                            }
                        }
                        if (activeTarget === targetKey)
                            publish(++request, nextStatus);
                        return nextStatus;
                    },

                    async checkFavoriteStatus(
                        xtreamId: number | string,
                        playlistId: string,
                        contentType: 'live' | 'movie' | 'series',
                        identity?: ContentMetadataPatch
                    ) {
                        const owner = ++request;
                        const normalizedXtreamId = Number(xtreamId);
                        const targetKey = favoriteTargetKey(
                            playlistId,
                            contentType,
                            normalizedXtreamId,
                            identity
                        );
                        activeTarget = targetKey;
                        if (
                            !Number.isFinite(normalizedXtreamId) ||
                            normalizedXtreamId <= 0 ||
                            !playlistId
                        ) {
                            publish(owner, false);
                            return;
                        }

                        const content = await dataSource.getContentByXtreamId(
                            normalizedXtreamId,
                            playlistId,
                            contentType,
                            ...(runtime.supportsXtreamSqliteDataSource &&
                            identity
                                ? [identity]
                                : [])
                        );
                        const contentId =
                            content?.id ??
                            (!runtime.supportsXtreamSqliteDataSource
                                ? normalizedXtreamId
                                : null);

                        if (contentId == null) {
                            publish(owner, false);
                            return;
                        }

                        const isFavorite = await dataSource.isFavorite(
                            {
                                id: contentId,
                                type: contentType,
                                ...(!runtime.supportsXtreamSqliteDataSource &&
                                identity
                                    ? { identity }
                                    : {}),
                            },
                            playlistId
                        );

                        publish(owner, isFavorite);
                    },
                };
            }
        )
    );
};
