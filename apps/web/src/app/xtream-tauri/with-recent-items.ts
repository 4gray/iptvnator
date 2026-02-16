import { inject, Signal } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { DatabaseService } from 'services';
import { createLogger } from '../shared/utils/logger';

export interface RecentlyViewedItem {
    id: number;
    title: string;
    type: 'live' | 'movie' | 'series';
    poster_url: string;
    content_id: number;
    playlist_id: string;
    viewed_at: string;
    xtream_id: number;
    category_id: number;
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
        withMethods((store, dbService = inject(DatabaseService)) => ({
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
                    const items = await dbService.getGlobalRecentlyViewed();
                    patchState(store, {
                        recentItems: items || [],
                    });
                } catch (error) {
                    logger.error('Error loading global recent items', error);
                    patchState(store, { recentItems: [] });
                }
            },
            async clearGlobalRecentlyViewed() {
                try {
                    await dbService.clearGlobalRecentlyViewed();
                    patchState(store, { recentItems: [] });
                } catch (error) {
                    logger.error('Error clearing global recently viewed', error);
                }
            },
        }))
    );
};
