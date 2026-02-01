/**
 * Playback Position IPC event handlers
 * Operations for managing video playback progress
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

/**
 * Ensure playlist exists in SQLite (auto-create if missing)
 * This handles legacy playlists that weren't synced to SQLite
 */
async function ensurePlaylistExists(
    db: any,
    playlistId: string,
    playlistType: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url' = 'stalker'
): Promise<void> {
    const existing = await db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, playlistId))
        .limit(1);

    if (existing.length === 0) {
        // Create a minimal placeholder entry for the playlist
        await db.insert(schema.playlists).values({
            id: playlistId,
            name: 'Imported Playlist',
            type: playlistType,
        });
    }
}

/**
 * Save/update playback position for content
 */
ipcMain.handle(
    'DB_SAVE_PLAYBACK_POSITION',
    async (event, playlistId: string, data: any) => {
        try {
            const db = await getDatabase();

            // Ensure playlist exists (handles legacy playlists not in SQLite)
            await ensurePlaylistExists(db, playlistId, data.playlistType);

            // Prepare values
            const values = {
                playlistId,
                contentXtreamId: data.contentXtreamId,
                contentType: data.contentType,
                seriesXtreamId: data.seriesXtreamId,
                seasonNumber: data.seasonNumber,
                episodeNumber: data.episodeNumber,
                positionSeconds: data.positionSeconds,
                durationSeconds: data.durationSeconds,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            };

            // Check if exists
            const existing = await db
                .select()
                .from(schema.playbackPositions)
                .where(
                    and(
                        eq(schema.playbackPositions.playlistId, playlistId),
                        eq(
                            schema.playbackPositions.contentXtreamId,
                            data.contentXtreamId
                        ),
                        eq(
                            schema.playbackPositions.contentType,
                            data.contentType
                        )
                    )
                )
                .limit(1);

            if (existing.length > 0) {
                await db
                    .update(schema.playbackPositions)
                    .set(values)
                    .where(eq(schema.playbackPositions.id, existing[0].id));
            } else {
                await db.insert(schema.playbackPositions).values(values);
            }

            return { success: true };
        } catch (error) {
            console.error('Error saving playback position:', error);
            throw error;
        }
    }
);

/**
 * Get playback position for a specific content item
 */
ipcMain.handle(
    'DB_GET_PLAYBACK_POSITION',
    async (
        event,
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ) => {
        try {
            const db = await getDatabase();
            const result = await db
                .select()
                .from(schema.playbackPositions)
                .where(
                    and(
                        eq(schema.playbackPositions.playlistId, playlistId),
                        eq(
                            schema.playbackPositions.contentXtreamId,
                            contentXtreamId
                        ),
                        eq(schema.playbackPositions.contentType, contentType)
                    )
                )
                .limit(1);

            return result[0] || null;
        } catch (error) {
            console.error('Error getting playback position:', error);
            throw error;
        }
    }
);

/**
 * Get all episode positions for a series
 */
ipcMain.handle(
    'DB_GET_SERIES_PLAYBACK_POSITIONS',
    async (event, playlistId: string, seriesXtreamId: number) => {
        try {
            const db = await getDatabase();
            const result = await db
                .select()
                .from(schema.playbackPositions)
                .where(
                    and(
                        eq(schema.playbackPositions.playlistId, playlistId),
                        eq(
                            schema.playbackPositions.seriesXtreamId,
                            seriesXtreamId
                        ),
                        eq(schema.playbackPositions.contentType, 'episode')
                    )
                );

            return result;
        } catch (error) {
            console.error('Error getting series playback positions:', error);
            throw error;
        }
    }
);

/**
 * Get recently watched items with positions
 */
ipcMain.handle(
    'DB_GET_RECENT_PLAYBACK_POSITIONS',
    async (event, playlistId: string, limit: number = 20) => {
        try {
            const db = await getDatabase();
            const result = await db
                .select()
                .from(schema.playbackPositions)
                .where(eq(schema.playbackPositions.playlistId, playlistId))
                .orderBy(desc(schema.playbackPositions.updatedAt))
                .limit(limit);

            return result;
        } catch (error) {
            console.error('Error getting recent playback positions:', error);
            throw error;
        }
    }
);

/**
 * Get all playback positions for a playlist (to populate grid view)
 */
ipcMain.handle(
    'DB_GET_ALL_PLAYBACK_POSITIONS',
    async (event, playlistId: string) => {
        try {
            const db = await getDatabase();
            const result = await db
                .select()
                .from(schema.playbackPositions)
                .where(eq(schema.playbackPositions.playlistId, playlistId));

            return result;
        } catch (error) {
            console.error('Error getting all playback positions:', error);
            throw error;
        }
    }
);

/**
 * Clear playback position
 */
ipcMain.handle(
    'DB_CLEAR_PLAYBACK_POSITION',
    async (
        event,
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ) => {
        try {
            const db = await getDatabase();
            await db
                .delete(schema.playbackPositions)
                .where(
                    and(
                        eq(schema.playbackPositions.playlistId, playlistId),
                        eq(
                            schema.playbackPositions.contentXtreamId,
                            contentXtreamId
                        ),
                        eq(schema.playbackPositions.contentType, contentType)
                    )
                );
            return { success: true };
        } catch (error) {
            console.error('Error clearing playback position:', error);
            throw error;
        }
    }
);
