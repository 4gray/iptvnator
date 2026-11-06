import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { DestroyRef, inject } from '@angular/core';
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
                const sqlite = () => runtime.supportsXtreamSqliteDataSource;
                let request = 0;
                let activeTarget = '';
                const publish = (owner: number, isFavorite: boolean) => {
                    if (owner === request) patchState(store, { isFavorite });
                };
                let refresh: (() => Promise<void>) | undefined;
                const changed = () => {
                    void refresh?.().catch(() => undefined);
                };
                const changes = new AbortController();
                window.addEventListener(
                    'iptvnator-favorites-changed',
                    changed,
                    { signal: changes.signal }
                );
                inject(DestroyRef).onDestroy(() => changes.abort());
                const resolveTarget = async (
                    id: number,
                    playlist: string,
                    type: 'live' | 'movie' | 'series',
                    identity?: ContentMetadataPatch
                ) => {
                    const content = await dataSource.getContentByXtreamId(
                        id,
                        playlist,
                        type,
                        ...(sqlite() && identity ? [identity] : [])
                    );
                    const portable =
                        await dataSource.supportsPortableFavorites?.(playlist);
                    const contentId =
                        content?.id ?? (!sqlite() || portable ? id : null);
                    return contentId == null
                        ? null
                        : {
                              id: contentId,
                              providerId: id,
                              type,
                              ...((!sqlite() || portable) && identity
                                  ? { identity }
                                  : {}),
                          };
                };
                const methods = {
                    async toggleFavorite(
                        xtreamId: number | string,
                        playlistId: string,
                        contentType: 'live' | 'movie' | 'series',
                        backdropUrl?: string,
                        identity?: ContentMetadataPatch
                    ) {
                        refresh = () =>
                            methods.checkFavoriteStatus(
                                xtreamId,
                                playlistId,
                                contentType,
                                identity
                            );
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
                            return false;
                        }

                        const target = await resolveTarget(
                            normalizedXtreamId,
                            playlistId,
                            contentType,
                            identity
                        );

                        if (!target) {
                            // A typed identity filter can reject all existing copies.
                            // Preserve the conflict feedback without mutating a contrary row.
                            const candidate =
                                identity && sqlite()
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
                            publish(owner, nextStatus);
                        return nextStatus;
                    },

                    async checkFavoriteStatus(
                        xtreamId: number | string,
                        playlistId: string,
                        contentType: 'live' | 'movie' | 'series',
                        identity?: ContentMetadataPatch
                    ) {
                        refresh = () =>
                            methods.checkFavoriteStatus(
                                xtreamId,
                                playlistId,
                                contentType,
                                identity
                            );
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

                        const target = await resolveTarget(
                            normalizedXtreamId,
                            playlistId,
                            contentType,
                            identity
                        );

                        if (!target) {
                            publish(owner, false);
                            return;
                        }

                        const isFavorite = await dataSource.isFavorite(
                            target,
                            playlistId
                        );

                        publish(owner, isFavorite);
                    },
                };
                return methods;
            }
        )
    );
};
