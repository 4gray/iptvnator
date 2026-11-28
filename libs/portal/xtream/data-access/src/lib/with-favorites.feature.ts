import { captureHistoryOwner } from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import { NotificationService } from '@iptvnator/services/notifications';
import { FavoriteChannelMembershipEvents } from '@iptvnator/services/favorites-events';
import { DestroyRef, inject } from '@angular/core';
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
                // The store exists from startup; NotificationService loads the
                // snack-bar chunk on the first toast, not at startup.
                notifications = inject(NotificationService),
                favoriteMembership = inject(FavoriteChannelMembershipEvents)
            ) => {
                const activity = inject(SourceActivityService);
                const sqlite = () => runtime.supportsXtreamSqliteDataSource;
                const pendingWrites = new Map<
                    string,
                    Promise<boolean | undefined>
                >();
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

                        const current = captureHistoryOwner(
                            sourceConnection()?.instanceId,
                            playlistId,
                            () => sourceConnection()?.instanceId,
                            'favorites'
                        );
                        const write = async () => {
                            if (!current()) return;
                            const target = await resolveTarget(
                                normalizedXtreamId,
                                playlistId,
                                contentType,
                                identity
                            );

                            if (!current()) return;
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
                                if (!current()) return;
                                if (candidate && activeTarget === targetKey) {
                                    notifications.error(
                                        'PORTALS.FAVORITE_IDENTITY_CONFLICT'
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
                            if (!current()) return;
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
                                if (contentType === 'live' && current())
                                    favoriteMembership.notify({
                                        sourceType: 'xtream',
                                        playlistId,
                                        xtreamId: normalizedXtreamId,
                                    });
                            } catch (error) {
                                nextStatus = currentStatus;
                                if (activeTarget === targetKey) {
                                    const key =
                                        error instanceof Error &&
                                        error.message ===
                                            XTREAM_FAVORITE_IDENTITY_CONFLICT
                                            ? 'PORTALS.FAVORITE_IDENTITY_CONFLICT'
                                            : 'PORTALS.FAVORITE_SAVE_FAILED';
                                    notifications.error(key);
                                }
                            }
                            if (!current()) return;
                            if (activeTarget === targetKey)
                                publish(owner, nextStatus);
                            return nextStatus;
                        };
                        const run = () =>
                            sqlite() && contentType === 'live'
                                ? activity.runWhenIdle(playlistId, write)
                                : write();
                        const previous = pendingWrites.get(targetKey);
                        const mutation = previous
                            ? previous.catch(() => undefined).then(run)
                            : run();
                        pendingWrites.set(targetKey, mutation);
                        try {
                            return await mutation;
                        } finally {
                            if (pendingWrites.get(targetKey) === mutation)
                                pendingWrites.delete(targetKey);
                        }
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

                        const mutation = pendingWrites.get(targetKey);
                        if (mutation) await mutation.catch(() => undefined);
                        if (owner !== request) return;
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
