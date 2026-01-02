/**
 * EPG Database IPC event handlers
 * Operations for storing and querying EPG data in SQLite with FTS5 support
 */

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

const loggerLabel = '[EPG DB]';

/**
 * Save EPG channels in bulk (upsert)
 */
ipcMain.handle(
    'EPG_DB_SAVE_CHANNELS',
    async (
        _event,
        sourceUrl: string,
        channels: Array<{
            id: string;
            displayName: string;
            iconUrl?: string;
            url?: string;
        }>
    ) => {
        try {
            const db = await getDatabase();

            // Delete existing channels from this source first
            await db
                .delete(schema.epgChannels)
                .where(eq(schema.epgChannels.sourceUrl, sourceUrl));

            if (channels.length === 0) return { success: true, count: 0 };

            // Insert in chunks
            const CHUNK_SIZE = 500;
            let totalInserted = 0;

            for (let i = 0; i < channels.length; i += CHUNK_SIZE) {
                const chunk = channels.slice(i, i + CHUNK_SIZE);
                const values = chunk.map((ch) => ({
                    id: ch.id,
                    displayName: ch.displayName,
                    iconUrl: ch.iconUrl || null,
                    url: ch.url || null,
                    sourceUrl,
                }));

                await db.insert(schema.epgChannels).values(values);
                totalInserted += chunk.length;
            }

            console.log(
                loggerLabel,
                `Saved ${totalInserted} channels from ${sourceUrl}`
            );
            return { success: true, count: totalInserted };
        } catch (error) {
            console.error(loggerLabel, 'Error saving EPG channels:', error);
            throw error;
        }
    }
);

/**
 * Save EPG programs in bulk
 */
ipcMain.handle(
    'EPG_DB_SAVE_PROGRAMS',
    async (
        _event,
        programs: Array<{
            channelId: string;
            start: string;
            stop: string;
            title: string;
            description?: string;
            category?: string;
            iconUrl?: string;
            rating?: string;
            episodeNum?: string;
        }>
    ) => {
        try {
            const db = await getDatabase();

            if (programs.length === 0) return { success: true, count: 0 };

            // Insert in chunks for better performance
            const CHUNK_SIZE = 500;
            let totalInserted = 0;

            for (let i = 0; i < programs.length; i += CHUNK_SIZE) {
                const chunk = programs.slice(i, i + CHUNK_SIZE);
                const values = chunk.map((prog) => ({
                    channelId: prog.channelId,
                    start: prog.start,
                    stop: prog.stop,
                    title: prog.title,
                    description: prog.description || null,
                    category: prog.category || null,
                    iconUrl: prog.iconUrl || null,
                    rating: prog.rating || null,
                    episodeNum: prog.episodeNum || null,
                }));

                await db.insert(schema.epgPrograms).values(values);
                totalInserted += chunk.length;
            }

            console.log(loggerLabel, `Saved ${totalInserted} programs`);
            return { success: true, count: totalInserted };
        } catch (error) {
            console.error(loggerLabel, 'Error saving EPG programs:', error);
            throw error;
        }
    }
);

/**
 * Get programs for a specific channel
 */
ipcMain.handle(
    'EPG_DB_GET_CHANNEL_PROGRAMS',
    async (_event, channelId: string, fromTime?: string, toTime?: string) => {
        try {
            const db = await getDatabase();
            const now = new Date().toISOString();

            let query = db
                .select()
                .from(schema.epgPrograms)
                .where(eq(schema.epgPrograms.channelId, channelId));

            // Apply time filters if provided
            if (fromTime && toTime) {
                query = db
                    .select()
                    .from(schema.epgPrograms)
                    .where(
                        and(
                            eq(schema.epgPrograms.channelId, channelId),
                            gte(schema.epgPrograms.stop, fromTime),
                            lte(schema.epgPrograms.start, toTime)
                        )
                    );
            } else {
                // Default: from now onwards
                query = db
                    .select()
                    .from(schema.epgPrograms)
                    .where(
                        and(
                            eq(schema.epgPrograms.channelId, channelId),
                            gte(schema.epgPrograms.stop, now)
                        )
                    );
            }

            const results = await query.orderBy(schema.epgPrograms.start);
            return results;
        } catch (error) {
            console.error(
                loggerLabel,
                'Error getting channel programs:',
                error
            );
            throw error;
        }
    }
);

/**
 * Get current program for a channel (what's on now)
 */
ipcMain.handle('EPG_DB_GET_CURRENT_PROGRAM', async (_event, channelId: string) => {
    try {
        const db = await getDatabase();
        const now = new Date().toISOString();

        const result = await db
            .select()
            .from(schema.epgPrograms)
            .where(
                and(
                    eq(schema.epgPrograms.channelId, channelId),
                    lte(schema.epgPrograms.start, now),
                    gte(schema.epgPrograms.stop, now)
                )
            )
            .limit(1);

        return result[0] || null;
    } catch (error) {
        console.error(loggerLabel, 'Error getting current program:', error);
        throw error;
    }
});

/**
 * Full-text search EPG programs using FTS5 with LIKE fallback
 * Handles Cyrillic and other Unicode text properly
 * Includes channel display name via JOIN
 */
ipcMain.handle(
    'EPG_DB_SEARCH_PROGRAMS',
    async (_event, searchTerm: string, limit = 50) => {
        try {
            const db = await getDatabase();
            const now = new Date().toISOString();
            const trimmedTerm = searchTerm.trim();

            if (!trimmedTerm) {
                return [];
            }

            // Use LIKE for substring matching (works better with Cyrillic)
            // This is more intuitive for users expecting exact substring matches
            const likePattern = `%${trimmedTerm}%`;

            // JOIN with epg_channels to get channel display name
            const results = await db.all(sql`
                SELECT
                    p.*,
                    c.display_name as channel_name
                FROM epg_programs p
                LEFT JOIN epg_channels c ON p.channel_id = c.id
                WHERE (
                    p.title LIKE ${likePattern}
                    OR p.description LIKE ${likePattern}
                    OR p.category LIKE ${likePattern}
                )
                AND p.stop >= ${now}
                ORDER BY p.start
                LIMIT ${limit}
            `);

            return results;
        } catch (error) {
            console.error(loggerLabel, 'Error searching EPG programs:', error);
            throw error;
        }
    }
);

/**
 * Get all EPG channels
 */
ipcMain.handle('EPG_DB_GET_CHANNELS', async () => {
    try {
        const db = await getDatabase();
        const results = await db
            .select()
            .from(schema.epgChannels)
            .orderBy(schema.epgChannels.displayName);
        return results;
    } catch (error) {
        console.error(loggerLabel, 'Error getting EPG channels:', error);
        throw error;
    }
});

/**
 * Get channel by ID or display name
 */
ipcMain.handle('EPG_DB_GET_CHANNEL', async (_event, channelIdOrName: string) => {
    try {
        const db = await getDatabase();

        // Try exact ID match first
        let result = await db
            .select()
            .from(schema.epgChannels)
            .where(eq(schema.epgChannels.id, channelIdOrName))
            .limit(1);

        if (result.length > 0) return result[0];

        // Try display name match (case-insensitive)
        result = await db
            .select()
            .from(schema.epgChannels)
            .where(
                sql`LOWER(${schema.epgChannels.displayName}) = LOWER(${channelIdOrName})`
            )
            .limit(1);

        return result[0] || null;
    } catch (error) {
        console.error(loggerLabel, 'Error getting EPG channel:', error);
        throw error;
    }
});

/**
 * Cleanup expired programs (older than specified hours)
 */
ipcMain.handle('EPG_DB_CLEANUP_EXPIRED', async (_event, hoursToKeep = 24) => {
    try {
        const db = await getDatabase();
        const cutoff = new Date(
            Date.now() - hoursToKeep * 60 * 60 * 1000
        ).toISOString();

        const result = await db
            .delete(schema.epgPrograms)
            .where(lte(schema.epgPrograms.stop, cutoff));

        console.log(
            loggerLabel,
            `Cleaned up expired programs (older than ${hoursToKeep}h)`
        );
        return { success: true };
    } catch (error) {
        console.error(loggerLabel, 'Error cleaning up EPG programs:', error);
        throw error;
    }
});

/**
 * Clear all EPG data for a specific source URL
 */
ipcMain.handle('EPG_DB_CLEAR_SOURCE', async (_event, sourceUrl: string) => {
    try {
        const db = await getDatabase();

        // Deleting channels will cascade delete programs due to foreign key
        await db
            .delete(schema.epgChannels)
            .where(eq(schema.epgChannels.sourceUrl, sourceUrl));

        console.log(loggerLabel, `Cleared EPG data for source: ${sourceUrl}`);
        return { success: true };
    } catch (error) {
        console.error(loggerLabel, 'Error clearing EPG source:', error);
        throw error;
    }
});

/**
 * Clear all EPG data
 */
ipcMain.handle('EPG_DB_CLEAR_ALL', async () => {
    try {
        const db = await getDatabase();

        await db.delete(schema.epgPrograms);
        await db.delete(schema.epgChannels);

        console.log(loggerLabel, 'Cleared all EPG data');
        return { success: true };
    } catch (error) {
        console.error(loggerLabel, 'Error clearing all EPG data:', error);
        throw error;
    }
});

/**
 * Get EPG statistics
 */
ipcMain.handle('EPG_DB_GET_STATS', async () => {
    try {
        const db = await getDatabase();

        const channelCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(schema.epgChannels);

        const programCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(schema.epgPrograms);

        const now = new Date().toISOString();
        const futureProgramCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(schema.epgPrograms)
            .where(gte(schema.epgPrograms.stop, now));

        return {
            channels: channelCount[0].count,
            programs: programCount[0].count,
            futurePrograms: futureProgramCount[0].count,
        };
    } catch (error) {
        console.error(loggerLabel, 'Error getting EPG stats:', error);
        throw error;
    }
});
