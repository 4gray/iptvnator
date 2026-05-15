import { inject, Signal } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { firstValueFrom, pipe, switchMap, tap } from 'rxjs';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import {
    buildPlaylistRecentItems,
    Playlist,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';

export interface RecentlyViewedItem extends PortalRecentItem {
    /** @deprecated Redundant — always equals `id`. Retained for compat. */
    content_id: number | string;
}

function mapDbRecentItem(
    item: {
        id: number;
        title: string;
        type: string;
        poster_url: string;
        backdrop_url?: string | null;
        viewed_at?: string;
        xtream_id: number;
        category_id: number;
    },
    playlistId: string
): RecentlyViewedItem {
    return {
        id: item.id,
        title: item.title,
        type: item.type as 'live' | 'movie' | 'series',
        poster_url: item.poster_url,
        backdrop_url: item.backdrop_url ?? undefined,
        content_id: item.id,
        playlist_id: playlistId,
        viewed_at: item.viewed_at || '',
        xtream_id: item.xtream_id,
        category_id: item.category_id,
    };
}

export const withRecentItems = function () {
    const logger = createLogger('withRecentItems');
    return signalStoreFeature(
        withState({
            recentItems: [],
        }),
        withMethods((store, dbService = inject(DatabaseService)) => ({
            loadRecentItems: rxMethod<{ id: string }>(
                pipe(
                    switchMap(async (playlist) => {
                        const items = await dbService.getRecentItems(
                            playlist.id
                        );
                        return items.map((item) =>
                            mapDbRecentItem(item, playlist.id)
                        );
                    }),
                    tap((items: RecentlyViewedItem[]) =>
                        patchState(store, { recentItems: items })
                    )
                )
            ),
        })),
        withMethods(
            (
                store,
                dbService = inject(DatabaseService),
                playlistsService = inject(PlaylistsService)
            ) => ({
                addRecentItem: rxMethod<{
                    xtreamId: number;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string }>;
                    backdropUrl?: string;
                }>(
                    pipe(
                        switchMap(
                            async ({
                                xtreamId,
                                contentType,
                                playlist,
                                backdropUrl,
                            }) => {
                            const playlistId = playlist().id;
                            const content = await dbService.getContentByXtreamId(
                                xtreamId,
                                playlistId,
                                contentType
                            );
                            if (content) {
                                await dbService.addRecentItem(
                                    content.id,
                                    playlistId,
                                    backdropUrl
                                );

                                // Reload after add/update so re-watched items
                                // immediately move to the top in recently-viewed.
                                const items =
                                    await dbService.getRecentItems(playlistId);
                                patchState(store, {
                                    recentItems: items.map((item) =>
                                        mapDbRecentItem(item, playlistId)
                                    ),
                                });
                            }
                        })
                    )
                ),
                async backfillContentBackdrop({
                    xtreamId,
                    contentType,
                    playlist,
                    backdropUrl,
                }: {
                    xtreamId: number;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string }>;
                    backdropUrl?: string;
                }): Promise<void> {
                    if (!window.electron) {
                        return;
                    }

                    const playlistId = playlist().id;
                    const normalizedBackdropUrl = backdropUrl?.trim();
                    if (!playlistId || !normalizedBackdropUrl) {
                        return;
                    }

                    const content = await dbService.getContentByXtreamId(
                        xtreamId,
                        playlistId,
                        contentType
                    );
                    if (!content) {
                        return;
                    }

                    await dbService.setContentBackdropIfMissing(
                        content.id,
                        normalizedBackdropUrl
                    );
                },
                clearRecentItems: rxMethod<{ id: string }>(
                    pipe(
                        switchMap(async (playlist) => {
                            await dbService.clearPlaylistRecentItems(
                                playlist.id
                            );
                            patchState(store, { recentItems: [] });
                        })
                    )
                ),
                removeRecentItem: rxMethod<{
                    itemId: number;
                    playlistId: string;
                }>(
                    pipe(
                        switchMap(async ({ itemId, playlistId }) => {
                            await dbService.removeRecentItem(
                                itemId,
                                playlistId
                            );
                            // Reload recent items to update UI
                            const items =
                                await dbService.getRecentItems(playlistId);
                            patchState(store, {
                                recentItems: items.map((item) =>
                                    mapDbRecentItem(item, playlistId)
                                ),
                            });
                        })
                    )
                ),
                async loadGlobalRecentItems() {
                    try {
                        const xtreamItems =
                            await dbService.getGlobalRecentlyViewed();
                        const playlists = (await firstValueFrom(
                            playlistsService.getAllPlaylists()
                        )) as Playlist[];
                        const playlistBackedItems =
                            buildPlaylistRecentItems(playlists, {
                                stalker: 'Stalker Portal',
                                m3u: 'M3U',
                            }).map((item) => ({
                                ...item,
                                content_id: item.id,
                            })) as RecentlyViewedItem[];

                        const normalizedXtream: RecentlyViewedItem[] = (
                            xtreamItems || []
                        ).map((item) => ({
                            id: item.id,
                            title: item.title,
                            type: item.type as 'live' | 'movie' | 'series',
                            poster_url: item.poster_url,
                            backdrop_url: item.backdrop_url ?? undefined,
                            content_id: item.id,
                            playlist_id: item.playlist_id,
                            playlist_name: item.playlist_name,
                            viewed_at: item.viewed_at,
                            xtream_id: item.xtream_id,
                            category_id: item.category_id,
                            source: 'xtream',
                        }));

                        const items = [
                            ...normalizedXtream,
                            ...playlistBackedItems,
                        ].sort(
                            (a, b) =>
                                new Date(b.viewed_at).getTime() -
                                new Date(a.viewed_at).getTime()
                        );
                        patchState(store, {
                            recentItems: items,
                        });
                    } catch (error) {
                        logger.error(
                            'Error loading global recent items',
                            error
                        );
                        patchState(store, { recentItems: [] });
                    }
                },
                async clearGlobalRecentlyViewed() {
                    try {
                        await dbService.clearGlobalRecentlyViewed();
                        const playlists = (await firstValueFrom(
                            playlistsService.getAllPlaylists()
                        )) as Playlist[];
                        await Promise.all(
                            playlists
                                .filter(
                                    (playlist) =>
                                        Boolean(playlist.macAddress) ||
                                        !playlist.serverUrl
                                )
                                .map((playlist) =>
                                    firstValueFrom(
                                        playlistsService.clearPlaylistRecentlyViewed(
                                            playlist._id
                                        )
                                    )
                                )
                        );
                        patchState(store, { recentItems: [] });
                    } catch (error) {
                        logger.error(
                            'Error clearing global recently viewed',
                            error
                        );
                    }
                },
            })
        )
    );
};
