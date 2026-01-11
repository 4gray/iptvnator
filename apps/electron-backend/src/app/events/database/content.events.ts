/**
 * Content IPC event handlers
 * Operations for managing and searching content (streams, movies, series)
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

/**
 * Escape special LIKE pattern characters to prevent unexpected matching behavior.
 * This escapes %, _, and \ which have special meaning in SQL LIKE patterns.
 */
function escapeLikePattern(term: string): string {
    return term.replace(/[%_\\]/g, '\\$&');
}

/**
 * Check if content exists
 */
ipcMain.handle(
    'DB_HAS_CONTENT',
    async (event, playlistId: string, type: 'live' | 'movie' | 'series') => {
        try {
            const db = await getDatabase();
            const result = await db
                .select({ count: sql<number>`count(*)` })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        eq(schema.content.type, type)
                    )
                );
            return result[0].count > 0;
        } catch (error) {
            console.error('Error checking content:', error);
            throw error;
        }
    }
);

/**
 * Get content for a playlist
 */
ipcMain.handle(
    'DB_GET_CONTENT',
    async (event, playlistId: string, type: 'live' | 'movie' | 'series') => {
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
                })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        eq(schema.content.type, type)
                    )
                )
                .orderBy(desc(schema.content.added));
            return result;
        } catch (error) {
            console.error('Error getting content:', error);
            throw error;
        }
    }
);

/**
 * Save content in bulk with progress reporting
 */
ipcMain.handle(
    'DB_SAVE_CONTENT',
    async (
        event,
        playlistId: string,
        streams: Array<Record<string, unknown>>,
        type: 'live' | 'movie' | 'series'
    ) => {
        try {
            console.log(
                `>>> DB_SAVE_CONTENT called: ${streams.length} items, type: ${type}, playlist: ${playlistId}`
            );
            const db = await getDatabase();
            const dbType =
                type === 'series'
                    ? 'series'
                    : type === 'movie'
                      ? 'movies'
                      : 'live';

            // Get categories with their IDs
            const categories = await db
                .select({
                    id: schema.categories.id,
                    xtreamId: schema.categories.xtreamId,
                })
                .from(schema.categories)
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        eq(schema.categories.type, dbType)
                    )
                );

            const categoryMap = new Map(
                categories.map((c) => [c.xtreamId, c.id])
            );

            // Prepare bulk insert data
            const values = streams
                .map((stream) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const s = stream as any;
                    const streamCategoryId =
                        type === 'series'
                            ? parseInt(s.category_id || '0')
                            : parseInt(s.category_id);

                    const categoryId = categoryMap.get(streamCategoryId);
                    if (!categoryId) return null;

                    const title =
                        type === 'series'
                            ? s.title ||
                              s.name ||
                              `Unknown Series ${s.series_id}`
                            : s.name ||
                              s.title ||
                              `Unknown Stream ${s.stream_id}`;

                    return {
                        categoryId,
                        title,
                        rating: s.rating || s.rating_imdb || '',
                        added:
                            type === 'series'
                                ? s.last_modified || ''
                                : s.added || '',
                        posterUrl: s.stream_icon || s.poster || s.cover || '',
                        xtreamId:
                            type === 'series'
                                ? parseInt(s.series_id || '0')
                                : parseInt(s.stream_id || '0'),
                        type,
                    };
                })
                .filter((data) => data !== null);

            // Insert in chunks for better performance
            const CHUNK_SIZE = 100;
            let totalInserted = 0;

            for (let i = 0; i < values.length; i += CHUNK_SIZE) {
                const chunk = values.slice(i, i + CHUNK_SIZE);
                await db.insert(schema.content).values(
                    chunk as Array<{
                        categoryId: number;
                        title: string;
                        rating: string;
                        added: string;
                        posterUrl: string;
                        xtreamId: number;
                        type: 'live' | 'movie' | 'series';
                    }>
                );
                totalInserted += chunk.length;

                // Send progress update
                event.sender.send('DB_SAVE_CONTENT_PROGRESS', totalInserted);
            }

            return { success: true, count: totalInserted };
        } catch (error) {
            console.error('Error saving content:', error);
            throw error;
        }
    }
);

/**
 * Get content by xtream ID
 */
ipcMain.handle(
    'DB_GET_CONTENT_BY_XTREAM_ID',
    async (event, xtreamId: number, playlistId: string) => {
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
                })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .where(
                    and(
                        eq(schema.content.xtreamId, xtreamId),
                        eq(schema.categories.playlistId, playlistId)
                    )
                )
                .limit(1);
            return result[0] || null;
        } catch (error) {
            console.error('Error getting content by xtream ID:', error);
            throw error;
        }
    }
);

/**
 * Search content within a specific playlist
 */
ipcMain.handle(
    'DB_SEARCH_CONTENT',
    async (event, playlistId: string, searchTerm: string, types: string[]) => {
        try {
            const db = await getDatabase();
            // Note: SQLite's LOWER() only handles ASCII characters, not Unicode/Cyrillic.
            // We use a two-step approach:
            // 1. SQL filters by playlist and type
            // 2. JavaScript filters by title using proper Unicode toLowerCase()
            const searchTermLower = searchTerm.toLowerCase();

            const candidates = await db
                .select({
                    id: schema.content.id,
                    category_id: schema.content.categoryId,
                    title: schema.content.title,
                    rating: schema.content.rating,
                    added: schema.content.added,
                    poster_url: schema.content.posterUrl,
                    xtream_id: schema.content.xtreamId,
                    type: schema.content.type,
                })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        inArray(
                            schema.content.type,
                            types as Array<'live' | 'movie' | 'series'>
                        )
                    )
                );

            // Filter in JavaScript for proper Unicode case-insensitive search
            const result = candidates
                .filter(item => item.title?.toLowerCase().includes(searchTermLower))
                .slice(0, 50);

            return result;
        } catch (error) {
            console.error('Error searching content:', error);
            throw error;
        }
    }
);

/**
 * Global search across all playlists
 */
ipcMain.handle(
    'DB_GLOBAL_SEARCH',
    async (event, searchTerm: string, types: string[]) => {
        try {
            const db = await getDatabase();
            // Note: SQLite's LOWER() only handles ASCII characters, not Unicode/Cyrillic.
            // We use a two-step approach:
            // 1. SQL filters by type only
            // 2. JavaScript filters by title using proper Unicode toLowerCase()
            const searchTermLower = searchTerm.toLowerCase();

            const candidates = await db
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
                })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .innerJoin(
                    schema.playlists,
                    eq(schema.categories.playlistId, schema.playlists.id)
                )
                .where(
                    inArray(
                        schema.content.type,
                        types as Array<'live' | 'movie' | 'series'>
                    )
                );

            // Filter in JavaScript for proper Unicode case-insensitive search
            const result = candidates
                .filter(item => item.title?.toLowerCase().includes(searchTermLower))
                .sort((a, b) => a.title.localeCompare(b.title))
                .slice(0, 50);

            return result;
        } catch (error) {
            console.error('Error in global search:', error);
            throw error;
        }
    }
);
