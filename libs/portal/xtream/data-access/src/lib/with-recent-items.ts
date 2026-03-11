import { inject, Signal } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { firstValueFrom, pipe, switchMap, tap } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import {
    buildPlaylistRecentItems,
    Playlist,
    PortalRecentItem,
} from 'shared-interfaces';
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
                    contentId: number;
                    playlist: Signal<{ id: string }>;
                }>(
                    pipe(
                        switchMap(async ({ contentId, playlist }) => {
                            // contentId is actually xtream_id, need to look up the database content.id
                            const playlistId = playlist().id;
                            const content =
                                await dbService.getContentByXtreamId(
                                    contentId,
                                    playlistId
                                );
                            if (content) {
                                await dbService.addRecentItem(
                                    content.id,
                                    playlistId
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
