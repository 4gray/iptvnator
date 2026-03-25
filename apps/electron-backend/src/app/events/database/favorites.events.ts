/**
 * Favorites IPC event handlers
 * Operations for managing user's favorite content
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
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

/**
 * Get global favorites across all playlists (live TV channels only)
 */
ipcMain.handle('DB_GET_GLOBAL_FAVORITES', async () => {
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
                playlist_id: schema.playlists.id,
                playlist_name: schema.playlists.name,
                added_at: schema.favorites.addedAt,
                position: schema.favorites.position,
            })
            .from(schema.favorites)
            .innerJoin(
                schema.content,
                eq(schema.favorites.contentId, schema.content.id)
            )
            .innerJoin(
                schema.categories,
                eq(schema.content.categoryId, schema.categories.id)
            )
            .innerJoin(
                schema.playlists,
                eq(schema.categories.playlistId, schema.playlists.id)
            )
            .where(eq(schema.content.type, 'live'))
            .orderBy(
                asc(schema.favorites.position),
                desc(schema.favorites.addedAt)
            )
            .limit(300);
        return result;
    } catch (error) {
        console.error('Error getting global favorites:', error);
        throw error;
    }
});

/**
 * Get global favorites across all playlists (all content types)
 */
ipcMain.handle('DB_GET_ALL_GLOBAL_FAVORITES', async () => {
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
                playlist_id: schema.playlists.id,
                playlist_name: schema.playlists.name,
                added_at: schema.favorites.addedAt,
                position: schema.favorites.position,
            })
            .from(schema.favorites)
            .innerJoin(
                schema.content,
                eq(schema.favorites.contentId, schema.content.id)
            )
            .innerJoin(
                schema.categories,
                eq(schema.content.categoryId, schema.categories.id)
            )
            .innerJoin(
                schema.playlists,
                eq(schema.categories.playlistId, schema.playlists.id)
            )
            .orderBy(
                asc(schema.favorites.position),
                desc(schema.favorites.addedAt)
            )
            .limit(500);
        return result;
    } catch (error) {
        console.error('Error getting all global favorites:', error);
        throw error;
    }
});

/**
 * Reorder global favorites by updating the position field on each Xtream favorite row.
 * Accepts an array of { content_id, position } pairs.
 */
ipcMain.handle(
    'DB_REORDER_GLOBAL_FAVORITES',
    async (event, updates: { content_id: number; position: number }[]) => {
        try {
            if (!Array.isArray(updates) || updates.length === 0) {
                return { success: true };
            }
            const db = await getDatabase();
            for (const { content_id, position } of updates) {
                await db
                    .update(schema.favorites)
                    .set({ position })
                    .where(eq(schema.favorites.contentId, content_id));
            }
            return { success: true };
        } catch (error) {
            console.error('Error reordering global favorites:', error);
            throw error;
        }
    }
);
