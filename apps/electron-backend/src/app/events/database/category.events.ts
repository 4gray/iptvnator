/**
 * Category IPC event handlers
 * Operations for managing categories within playlists
 */

import { and, eq, sql } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

/**
 * Check if categories exist for a playlist
 */
ipcMain.handle(
    'DB_HAS_CATEGORIES',
    async (event, playlistId: string, type: 'live' | 'movies' | 'series') => {
        try {
            const db = await getDatabase();
            const result = await db
                .select({ count: sql<number>`count(*)` })
                .from(schema.categories)
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        eq(schema.categories.type, type)
                    )
                );
            return result[0].count > 0;
        } catch (error) {
            console.error('Error checking categories:', error);
            throw error;
        }
    }
);

/**
 * Get categories for a playlist
 */
ipcMain.handle(
    'DB_GET_CATEGORIES',
    async (event, playlistId: string, type: 'live' | 'movies' | 'series') => {
        try {
            const db = await getDatabase();
            const result = await db
                .select()
                .from(schema.categories)
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        eq(schema.categories.type, type)
                    )
                )
                .orderBy(sql`name COLLATE NOCASE`);
            return result;
        } catch (error) {
            console.error('Error getting categories:', error);
            throw error;
        }
    }
);

/**
 * Save categories in bulk
 */
ipcMain.handle(
    'DB_SAVE_CATEGORIES',
    async (
        event,
        playlistId: string,
        categories: Array<{
            category_name: string;
            category_id: number;
        }>,
        type: 'live' | 'movies' | 'series'
    ) => {
        try {
            const db = await getDatabase();
            const values = categories.map((cat) => ({
                playlistId,
                name: cat.category_name,
                type,
                xtreamId: cat.category_id,
            }));

            await db.insert(schema.categories).values(values);
            return { success: true };
        } catch (error) {
            console.error('Error saving categories:', error);
            throw error;
        }
    }
);
