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
import { createLogger } from '../shared/utils/logger';

export interface RecentlyViewedItem {
    id: number | string;
    title: string;
    type: 'live' | 'movie' | 'series';
    poster_url: string;
    content_id: number | string;
    playlist_id: string;
    playlist_name?: string;
    viewed_at: string;
    xtream_id: number | string;
    category_id: number | string;
    source?: 'xtream' | 'stalker';
    stalker_item?: any;
}

export const withRecentItems = function () {
    const logger = createLogger('withRecentItems');
    return signalStoreFeature(
        withState({
            recentItems: [],
        }),
        withMethods(
            (
                store,
                dbService = inject(DatabaseService),
                playlistsService = inject(PlaylistsService)
            ) => ({
            loadRecentItems: rxMethod<{ id: string }>(
                pipe(
                    switchMap(async (playlist) => {
                        const items = await dbService.getRecentItems(
                            playlist.id
                        );
                        // Map to RecentlyViewedItem format
                        return items.map((item) => ({
                            id: item.id,
                            title: item.title,
                            type: item.type as 'live' | 'movie' | 'series',
                            poster_url: item.poster_url,
                            content_id: item.id,
                            playlist_id: playlist.id,
                            viewed_at: item.viewed_at || '',
                            xtream_id: item.xtream_id,
                            category_id: item.category_id,
                        }));
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
                        const content = await dbService.getContentByXtreamId(
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
                                recentItems: items.map((item) => ({
                                    id: item.id,
                                    title: item.title,
                                    type: item.type as
                                        | 'live'
                                        | 'movie'
                                        | 'series',
                                    poster_url: item.poster_url,
                                    content_id: item.id,
                                    playlist_id: playlistId,
                                    viewed_at: item.viewed_at || '',
                                    xtream_id: item.xtream_id,
                                    category_id: item.category_id,
                                })),
                            });
                        }
                    })
                )
            ),
            clearRecentItems: rxMethod<{ id: string }>(
                pipe(
                    switchMap(async (playlist) => {
                        await dbService.clearPlaylistRecentItems(playlist.id);
                        patchState(store, { recentItems: [] });
                    })
                )
            ),
            removeRecentItem: rxMethod<{ itemId: number; playlistId: string }>(
                pipe(
                    switchMap(async ({ itemId, playlistId }) => {
                        await dbService.removeRecentItem(itemId, playlistId);
                        // Reload recent items to update UI
                        const items =
                            await dbService.getRecentItems(playlistId);
                        const mappedItems = items.map((item) => ({
                            id: item.id,
                            title: item.title,
                            type: item.type as 'live' | 'movie' | 'series',
                            poster_url: item.poster_url,
                            content_id: item.id,
                            playlist_id: playlistId,
                            viewed_at: item.viewed_at || '',
                            xtream_id: item.xtream_id,
                            category_id: item.category_id,
                        }));
                        patchState(store, { recentItems: mappedItems });
                    })
                )
            ),
            async loadGlobalRecentItems() {
                try {
                    const xtreamItems = await dbService.getGlobalRecentlyViewed();
                    const playlists = (await firstValueFrom(
                        playlistsService.getAllPlaylists()
                    )) as any[];
                    const stalkerItems: RecentlyViewedItem[] = playlists
                        .filter((playlist: any) => Boolean(playlist.macAddress))
                        .reduce(
                            (acc: RecentlyViewedItem[], playlist: any) => {
                                const recent = Array.isArray(
                                    playlist.recentlyViewed
                                )
                                    ? playlist.recentlyViewed
                                    : [];
                                const mapped = recent.map((item: any) => {
                                    const categoryId = String(
                                        item?.category_id ?? ''
                                    );
                                    const type =
                                        categoryId === 'itv'
                                            ? 'live'
                                            : categoryId === 'series'
                                              ? 'series'
                                              : 'movie';
                                    const viewedAt = (() => {
                                        const raw = item?.added_at;
                                        if (
                                            typeof raw === 'number' ||
                                            /^\d+$/.test(String(raw ?? ''))
                                        ) {
                                            return new Date(
                                                Number(raw)
                                            ).toISOString();
                                        }
                                        const parsed = new Date(
                                            String(raw ?? '')
                                        );
                                        return Number.isNaN(parsed.getTime())
                                            ? new Date().toISOString()
                                            : parsed.toISOString();
                                    })();

                                    return {
                                        id: String(item?.id ?? ''),
                                        title:
                                            item?.title ??
                                            item?.o_name ??
                                            item?.name ??
                                            'Unknown',
                                        type,
                                        poster_url:
                                            item?.cover ??
                                            item?.logo ??
                                            item?.poster_url ??
                                            '',
                                        content_id: String(item?.id ?? ''),
                                        playlist_id: String(playlist._id),
                                        playlist_name:
                                            playlist.title || 'Stalker Portal',
                                        viewed_at: viewedAt,
                                        xtream_id: String(item?.id ?? ''),
                                        category_id: categoryId,
                                        source: 'stalker',
                                        stalker_item: item,
                                    };
                                });
                                acc.push(...mapped);
                                return acc;
                            },
                            []
                        );

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

                    const items = [...normalizedXtream, ...stalkerItems].sort(
                        (a, b) =>
                            new Date(b.viewed_at).getTime() -
                            new Date(a.viewed_at).getTime()
                    );
                    patchState(store, {
                        recentItems: items,
                    });
                } catch (error) {
                    logger.error('Error loading global recent items', error);
                    patchState(store, { recentItems: [] });
                }
            },
            async clearGlobalRecentlyViewed() {
                try {
                    await dbService.clearGlobalRecentlyViewed();
                    const playlists = (await firstValueFrom(
                        playlistsService.getAllPlaylists()
                    )) as any[];
                    await Promise.all(
                        playlists
                            .filter((playlist: any) =>
                                Boolean(playlist.macAddress)
                            )
                            .map((playlist: any) =>
                                firstValueFrom(
                                    playlistsService.clearPortalRecentlyViewed(
                                        playlist._id
                                    )
                                )
                            )
                    );
                    patchState(store, { recentItems: [] });
                } catch (error) {
                    logger.error('Error clearing global recently viewed', error);
                }
            },
        })
        )
    );
};
