import { inject, Signal } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { DatabaseService } from '../services/database.service';

export interface RecentlyViewedItem {
    id: number;
    title: string;
    type: 'live' | 'movie' | 'series';
    poster_url: string;
    content_id: number;
    playlist_id: string;
    viewed_at: string;
    xtream_id: number;
}

export const withRecentItems = function () {
    return signalStoreFeature(
        withState({
            recentItems: [],
        }),
        withMethods((store, dbService = inject(DatabaseService)) => ({
            loadRecentItems: rxMethod<{ id: string }>(
                pipe(
                    switchMap(async (playlist) => {
                        if (!playlist) return [];
                        console.log(
                            'Loading recent items for playlist',
                            playlist.id
                        );
                        const db = await dbService.getConnection();
                        return db.select<RecentlyViewedItem[]>(
                            `SELECT 
                                rv.id,
                                c.title,
                                c.type,
                                c.poster_url,
                                c.id as content_id,
                                rv.playlist_id,
                                rv.viewed_at,
                                c.xtream_id,
                                c.category_id
                            FROM recently_viewed rv
                            JOIN content c ON rv.content_id = c.id
                            WHERE rv.playlist_id = ?
                            ORDER BY rv.viewed_at DESC
                            LIMIT 50`,
                            [playlist.id]
                        );
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
                        if (!playlist().id) {
                            console.error('No active playlist found');
                            return;
                        }

                        console.log(
                            'Adding to recently viewed:',
                            playlist().id
                        );

                        const db = await dbService.getConnection();

                        const content: any = await db.select(
                            'SELECT content.id FROM content ' +
                                'INNER JOIN categories ON content.category_id = categories.id ' +
                                'WHERE content.xtream_id = ? AND categories.playlist_id = ?',
                            [contentId, playlist().id]
                        );

                        if (content && content.length > 0) {
                            // Check if item already exists in recently_viewed
                            const existing: any = await db.select(
                                'SELECT recently_viewed.id FROM recently_viewed ' +
                                    'INNER JOIN content ON recently_viewed.content_id = content.id ' +
                                    'INNER JOIN categories ON content.category_id = categories.id ' +
                                    'WHERE content.id = ? AND categories.playlist_id = ?',
                                [content[0].id, playlist().id]
                            );

                            if (existing && existing.length > 0) {
                                // Update existing record's viewed_at timestamp
                                await db.execute(
                                    'UPDATE recently_viewed SET viewed_at = CURRENT_TIMESTAMP WHERE id = ?',
                                    [existing[0].id]
                                );
                            } else {
                                // Insert new record
                                await db.execute(
                                    `INSERT INTO recently_viewed (content_id, playlist_id) 
                            VALUES (?, ?)`,
                                    [content[0].id, playlist().id]
                                );
                            }
                            return store.loadRecentItems({ id: playlist().id });
                        }
                    })
                )
            ),
            clearRecentItems: rxMethod<{ id: string }>(
                pipe(
                    switchMap(async (playlist) => {
                        console.log(
                            'Clearing recent items for playlist',
                            playlist.id
                        );
                        const db = await dbService.getConnection();
                        await db.execute(
                            `DELETE FROM recently_viewed WHERE playlist_id = ?`,
                            [playlist.id]
                        );
                        return store.loadRecentItems({ id: playlist.id });
                    })
                )
            ),
            removeRecentItem: rxMethod<{ itemId: number; playlistId: string }>(
                pipe(
                    switchMap(async ({ itemId, playlistId }) => {
                        const db = await dbService.getConnection();
                        await db.execute(
                            `DELETE FROM recently_viewed WHERE id = ? AND playlist_id = ?`,
                            [itemId, playlistId]
                        );
                        return store.loadRecentItems({ id: playlistId });
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
                    console.error('Error loading global recent items:', error);
                    patchState(store, { recentItems: [] });
                }
            },
            async clearGlobalRecentlyViewed() {
                try {
                    await dbService.clearGlobalRecentlyViewed();
                    patchState(store, { recentItems: [] });
                } catch (error) {
                    console.error(
                        'Error clearing global recently viewed:',
                        error
                    );
                }
            },
        }))
    );
};
