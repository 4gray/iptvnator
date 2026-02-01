/**
 * Playlist IPC event handlers
 * CRUD operations for playlists
 */

import { eq } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

/**
 * Create a new playlist
 */
ipcMain.handle(
    'DB_CREATE_PLAYLIST',
    async (
        event,
        playlist: {
            id: string;
            name: string;
            serverUrl?: string;
            username?: string;
            password?: string;
            macAddress?: string;
            url?: string;
            type: string;
        }
    ) => {
        try {
            const db = await getDatabase();
            await db.insert(schema.playlists).values({
                id: playlist.id,
                name: playlist.name,
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
                macAddress: playlist.macAddress,
                url: playlist.url,
                // enforce supported types
                type: playlist.type as
                    | 'xtream'
                    | 'stalker'
                    | 'm3u-file'
                    | 'm3u-text'
                    | 'm3u-url',
            });
            return { success: true };
        } catch (error) {
            console.error('Error creating playlist:', error);
            throw error;
        }
    }
);

/**
 * Get playlist by ID
 */
ipcMain.handle('DB_GET_PLAYLIST', async (event, playlistId: string) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.playlists)
            .where(eq(schema.playlists.id, playlistId))
            .limit(1);
        return result[0] || null;
    } catch (error) {
        console.error('Error getting playlist:', error);
        throw error;
    }
});

/**
 * Update playlist
 */
ipcMain.handle(
    'DB_UPDATE_PLAYLIST',
    async (
        event,
        playlistId: string,
        updates: {
            name?: string;
            username?: string;
            password?: string;
            serverUrl?: string;
            lastUpdated?: string;
        }
    ) => {
        try {
            const db = await getDatabase();
            await db
                .update(schema.playlists)
                .set(updates)
                .where(eq(schema.playlists.id, playlistId));
            return { success: true };
        } catch (error) {
            console.error('Error updating playlist:', error);
            throw error;
        }
    }
);

/**
 * Delete playlist and all related data
 */
ipcMain.handle('DB_DELETE_PLAYLIST', async (event, playlistId: string) => {
    try {
        const db = await getDatabase();

        // Delete playlist (cascade will handle related data)
        await db
            .delete(schema.playlists)
            .where(eq(schema.playlists.id, playlistId));

        return { success: true };
    } catch (error) {
        console.error('Error deleting playlist:', error);
        throw error;
    }
});

/**
 * Delete all playlists and related data from SQLite
 */
ipcMain.handle('DB_DELETE_ALL_PLAYLISTS', async () => {
    try {
        const db = await getDatabase();

        // Delete in order respecting foreign key constraints
        // First delete favorites and recently_viewed (they reference content)
        await db.delete(schema.favorites);
        await db.delete(schema.recentlyViewed);

        // Then delete content (references categories)
        await db.delete(schema.content);

        // Then delete categories (references playlists)
        await db.delete(schema.categories);

        // Finally delete playlists
        await db.delete(schema.playlists);

        return { success: true };
    } catch (error) {
        console.error('Error deleting all playlists:', error);
        throw error;
    }
});
