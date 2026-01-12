/**
 * Recently Viewed IPC event handlers
 * Operations for managing user's recently viewed content
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

/**
 * Get recently viewed items across all playlists
 */
ipcMain.handle('DB_GET_RECENTLY_VIEWED', async () => {
    try {
        const db = await getDatabase();
        const result = await db
            .select({
                id: schema.content.id,
                category_id: schema.content.categoryId,
                title: schema.content.title,
                rating: schema.content.rating,
                added: schema.content.added,
                poster_url: schema.content.posterUrl,
                xtream_id: schema.content.xtreamId,
                type: schema.content.type,
                playlist_id: schema.categories.playlistId,
                playlist_name: schema.playlists.name,
                viewed_at: schema.recentlyViewed.viewedAt,
            })
            .from(schema.recentlyViewed)
            .innerJoin(
                schema.content,
                eq(schema.recentlyViewed.contentId, schema.content.id)
            )
            .innerJoin(
                schema.categories,
                eq(schema.content.categoryId, schema.categories.id)
            )
            .innerJoin(
                schema.playlists,
                eq(schema.categories.playlistId, schema.playlists.id)
            )
            .orderBy(desc(schema.recentlyViewed.viewedAt))
            .limit(100);
        return result;
    } catch (error) {
        console.error('Error getting recently viewed:', error);
        throw error;
    }
});

/**
 * Clear all recently viewed items
 */
ipcMain.handle('DB_CLEAR_RECENTLY_VIEWED', async () => {
    try {
        const db = await getDatabase();
        await db.delete(schema.recentlyViewed);
        return { success: true };
    } catch (error) {
        console.error('Error clearing recently viewed:', error);
        throw error;
    }
});

/**
 * Get recently viewed items for a specific playlist
 */
ipcMain.handle('DB_GET_RECENT_ITEMS', async (event, playlistId: string) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select({
                id: schema.content.id,
                category_id: schema.content.categoryId,
                title: schema.content.title,
                rating: schema.content.rating,
                added: schema.content.added,
                poster_url: schema.content.posterUrl,
                xtream_id: schema.content.xtreamId,
                type: schema.content.type,
                viewed_at: schema.recentlyViewed.viewedAt,
            })
            .from(schema.recentlyViewed)
            .innerJoin(
                schema.content,
                eq(schema.recentlyViewed.contentId, schema.content.id)
            )
            .where(eq(schema.recentlyViewed.playlistId, playlistId))
            .orderBy(desc(schema.recentlyViewed.viewedAt))
            .limit(100);
        return result;
    } catch (error) {
        console.error('Error getting recent items:', error);
        throw error;
    }
});

/**
 * Add item to recently viewed
 */
ipcMain.handle(
    'DB_ADD_RECENT_ITEM',
    async (event, contentId: number, playlistId: string) => {
        try {
            const db = await getDatabase();

            // Check if already exists
            const existing = await db
                .select()
                .from(schema.recentlyViewed)
                .where(
                    and(
                        eq(schema.recentlyViewed.contentId, contentId),
                        eq(schema.recentlyViewed.playlistId, playlistId)
                    )
                )
                .limit(1);

            if (existing.length > 0) {
                // Update viewed_at timestamp
                await db
                    .update(schema.recentlyViewed)
                    .set({ viewedAt: sql`CURRENT_TIMESTAMP` })
                    .where(
                        and(
                            eq(schema.recentlyViewed.contentId, contentId),
                            eq(schema.recentlyViewed.playlistId, playlistId)
                        )
                    );
            } else {
                // Insert new entry
                await db.insert(schema.recentlyViewed).values({
                    contentId,
                    playlistId,
                });
            }

            return { success: true };
        } catch (error) {
            console.error('Error adding recent item:', error);
            throw error;
        }
    }
);

/**
 * Clear recently viewed for a specific playlist
 */
ipcMain.handle(
    'DB_CLEAR_PLAYLIST_RECENT_ITEMS',
    async (event, playlistId: string) => {
        try {
            const db = await getDatabase();

            // Get content IDs that belong to this playlist
            const contentIds = await db
                .select({ id: schema.content.id })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .where(eq(schema.categories.playlistId, playlistId));

            if (contentIds.length > 0) {
                await db.delete(schema.recentlyViewed).where(
                    inArray(
                        schema.recentlyViewed.contentId,
                        contentIds.map((c) => c.id)
                    )
                );
            }

            return { success: true };
        } catch (error) {
            console.error('Error clearing playlist recent items:', error);
            throw error;
        }
    }
);

/**
 * Remove specific item from recently viewed
 */
ipcMain.handle(
    'DB_REMOVE_RECENT_ITEM',
    async (event, contentId: number, playlistId: string) => {
        try {
            const db = await getDatabase();
            await db
                .delete(schema.recentlyViewed)
                .where(
                    and(
                        eq(schema.recentlyViewed.contentId, contentId),
                        eq(schema.recentlyViewed.playlistId, playlistId)
                    )
                );
            return { success: true };
        } catch (error) {
            console.error('Error removing recent item:', error);
            throw error;
        }
    }
);
