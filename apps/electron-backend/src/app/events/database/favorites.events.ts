/**
 * Favorites IPC event handlers
 * Operations for managing user's favorite content
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

/**
 * Add content to favorites
 */
ipcMain.handle(
    'DB_ADD_FAVORITE',
    async (event, contentId: number, playlistId: string) => {
        try {
            const db = await getDatabase();
            await db.insert(schema.favorites).values({
                contentId,
                playlistId,
            });
            return { success: true };
        } catch (error) {
            console.error('Error adding favorite:', error);
            throw error;
        }
    }
);

/**
 * Remove content from favorites
 */
ipcMain.handle(
    'DB_REMOVE_FAVORITE',
    async (event, contentId: number, playlistId: string) => {
        try {
            const db = await getDatabase();
            await db
                .delete(schema.favorites)
                .where(
                    and(
                        eq(schema.favorites.contentId, contentId),
                        eq(schema.favorites.playlistId, playlistId)
                    )
                );
            return { success: true };
        } catch (error) {
            console.error('Error removing favorite:', error);
            throw error;
        }
    }
);

/**
 * Check if content is favorited
 */
ipcMain.handle(
    'DB_IS_FAVORITE',
    async (event, contentId: number, playlistId: string) => {
        try {
            const db = await getDatabase();
            const result = await db
                .select({ count: sql<number>`count(*)` })
                .from(schema.favorites)
                .where(
                    and(
                        eq(schema.favorites.contentId, contentId),
                        eq(schema.favorites.playlistId, playlistId)
                    )
                );
            return result[0].count > 0;
        } catch (error) {
            console.error('Error checking favorite:', error);
            throw error;
        }
    }
);

/**
 * Get all favorites for a playlist
 */
ipcMain.handle('DB_GET_FAVORITES', async (event, playlistId: string) => {
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
                added_at: schema.favorites.addedAt,
            })
            .from(schema.favorites)
            .innerJoin(
                schema.content,
                eq(schema.favorites.contentId, schema.content.id)
            )
            .where(eq(schema.favorites.playlistId, playlistId))
            .orderBy(desc(schema.favorites.addedAt));
        return result;
    } catch (error) {
        console.error('Error getting favorites:', error);
        throw error;
    }
});
