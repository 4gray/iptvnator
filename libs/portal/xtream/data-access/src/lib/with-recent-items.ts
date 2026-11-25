import {
    captureHistoryOwner,
    XtreamHistoryOrder,
} from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { DestroyRef, inject, Signal } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    type,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    ContentMetadataPatch,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import {
    XTREAM_DATA_SOURCE,
    type XtreamPlayedContent,
} from './data-sources/xtream-data-source.interface';

export interface RecentlyViewedItem extends PortalRecentItem {
    /** @deprecated Native row ID; absent for received history without a catalog row. */
    content_id: number | string | null;
}

const recentOperations = () => import('./xtream-recent-operations');
const captureRecentOwner = (playlistId: string) =>
    captureHistoryOwner(
        sourceConnection()?.instanceId,
        playlistId,
        () => sourceConnection()?.instanceId
    );

export const withRecentItems = function () {
    return signalStoreFeature(
        { state: type<{ playlistId: string | null }>() },
        withState<{ recentItems: RecentlyViewedItem[] }>({
            recentItems: [],
        }),
        withMethods((store, dataSource = inject(XTREAM_DATA_SOURCE)) => {
            let refresh: (() => void) | undefined;
            const changes = new AbortController();
            window.addEventListener(
                'iptvnator-history-changed',
                () => refresh?.(),
                { signal: changes.signal }
            );
            inject(DestroyRef).onDestroy(() => changes.abort());
            const loadRecentItems = rxMethod<{ id: string }>(
                pipe(
                    switchMap(async (playlist) => {
                        const current = captureRecentOwner(playlist.id);
                        refresh = () => {
                            if (current() && store.playlistId() === playlist.id)
                                loadRecentItems(playlist);
                        };
                        const { loadXtreamRecent } = await recentOperations();
                        const items = await loadXtreamRecent(
                            dataSource,
                            playlist.id
                        );
                        if (!current() || store.playlistId() !== playlist.id)
                            return null;
                        return items;
                    }),
                    tap((items) => {
                        if (items) patchState(store, { recentItems: items });
                    })
                )
            );
            return {
                loadRecentItems,
                async prepareRecentActions(): Promise<void> {
                    await recentOperations();
                },
            };
        }),
        withMethods(
            (
                store,
                dataSource = inject(XTREAM_DATA_SOURCE),
                runtime = inject(RuntimeCapabilitiesService),
                historyOrder = inject(XtreamHistoryOrder)
            ) => ({
                addRecentItem: rxMethod<{
                    xtreamId: number | string;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string } | null | undefined>;
                    backdropUrl?: string;
                    playedContent?: XtreamPlayedContent;
                    viewedAt?: string;
                }>(
                    pipe(
                        switchMap(async ({ playlist, ...item }) => {
                            const playlistId = playlist()?.id;
                            if (!playlistId) return;
                            const current = captureRecentOwner(playlistId);
                            const sqlite =
                                runtime.supportsXtreamSqliteDataSource;
                            const write = async () => {
                                const { recordXtreamRecent } =
                                    await recentOperations();
                                return recordXtreamRecent(
                                    dataSource,
                                    sqlite,
                                    { ...item, playlistId },
                                    current
                                );
                            };
                            const items = sqlite
                                ? await historyOrder.run(
                                      playlistId,
                                      write,
                                      item.contentType === 'live'
                                          ? playlistId
                                          : undefined
                                  )
                                : await write();
                            if (items && store.playlistId() === playlistId)
                                patchState(store, {
                                    recentItems: items,
                                });
                        })
                    )
                ),
                async backfillContentMetadata({
                    xtreamId,
                    contentType,
                    playlist,
                    patch,
                }: {
                    xtreamId: number | string;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string } | null | undefined>;
                    patch: ContentMetadataPatch;
                }): Promise<void> {
                    const playlistId = playlist()?.id;
                    if (!playlistId) return;
                    const current = captureRecentOwner(playlistId);
                    const { backfillXtreamRecentMetadata } =
                        await recentOperations();
                    if (!current()) return;
                    await backfillXtreamRecentMetadata(
                        dataSource,
                        runtime.supportsXtreamSqliteDataSource,
                        {
                            playlistId,
                            xtreamId,
                            contentType,
                            patch,
                        },
                        current
                    );
                },
                clearRecentItems: rxMethod<{ id: string }>(
                    pipe(
                        switchMap(async (playlist) => {
                            const current = captureRecentOwner(playlist.id);
                            const clear = async () => {
                                if (!current()) return;
                                await dataSource.clearRecentItems(playlist.id);
                                if (
                                    current() &&
                                    store.playlistId() === playlist.id
                                )
                                    patchState(store, { recentItems: [] });
                            };
                            if (runtime.supportsXtreamSqliteDataSource)
                                await historyOrder.run(playlist.id, clear);
                            else await clear();
                        })
                    )
                ),
                removeRecentItem: rxMethod<{
                    itemId: number;
                    contentType?: 'live' | 'movie' | 'series';
                    playlistId: string;
                }>(
                    pipe(
                        switchMap(async (item) => {
                            const { removeXtreamRecent } =
                                await recentOperations();
                            const items = await removeXtreamRecent(
                                dataSource,
                                item
                            );
                            if (store.playlistId() === item.playlistId)
                                patchState(store, { recentItems: items });
                        })
                    )
                ),
            })
        )
    );
};
