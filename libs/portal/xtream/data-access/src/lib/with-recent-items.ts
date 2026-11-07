import { captureHistoryOwner } from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { DestroyRef, inject, Signal } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
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
                            if (current()) loadRecentItems(playlist);
                        };
                        const { loadXtreamRecent } = await recentOperations();
                        const items = await loadXtreamRecent(
                            dataSource,
                            playlist.id
                        );
                        if (!current()) return null;
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
                runtime = inject(RuntimeCapabilitiesService)
            ) => ({
                addRecentItem: rxMethod<{
                    xtreamId: number | string;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string } | null | undefined>;
                    backdropUrl?: string;
                    playedContent?: XtreamPlayedContent;
                }>(
                    pipe(
                        switchMap(async ({ playlist, ...item }) => {
                            const playlistId = playlist()?.id;
                            if (!playlistId) return;
                            const current = captureRecentOwner(playlistId);
                            const { recordXtreamRecent } =
                                await recentOperations();
                            if (!current()) return;
                            const items = await recordXtreamRecent(
                                dataSource,
                                runtime.supportsXtreamSqliteDataSource,
                                { ...item, playlistId },
                                current
                            );
                            if (items)
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
                            await dataSource.clearRecentItems(playlist.id);
                            patchState(store, { recentItems: [] });
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
                            patchState(store, { recentItems: items });
                        })
                    )
                ),
            })
        )
    );
};
