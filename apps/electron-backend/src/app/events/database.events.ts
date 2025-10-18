/**
 * Database IPC event handlers for Electron
 * Provides database operations to the renderer process
 */

import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';

export default class DatabaseEvents {
    static bootstrapDatabaseEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

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
 * Delete all content and categories for an Xtream playlist
 * Keeps the playlist entry but removes all imported data
 */
ipcMain.handle(
    'DB_DELETE_XTREAM_CONTENT',
    async (event, playlistId: string) => {
        try {
            const db = await getDatabase();

            // First, get all category IDs for this playlist
            const categories = await db
                .select({ id: schema.categories.id })
                .from(schema.categories)
                .where(eq(schema.categories.playlistId, playlistId));

            const categoryIds = categories.map((c) => c.id);

            console.log(
                `Deleting playlist content for ${playlistId}: ${categoryIds.length} categories found`
            );

            if (categoryIds.length > 0) {
                // Delete all content for these categories
                await db
                    .delete(schema.content)
                    .where(inArray(schema.content.categoryId, categoryIds));

                console.log(
                    `Deleted content for ${categoryIds.length} categories`
                );
            }

            // Delete all categories for this playlist
            // (Could rely on cascade delete, but being explicit is clearer)
            await db
                .delete(schema.categories)
                .where(eq(schema.categories.playlistId, playlistId));

            console.log(
                `Deleted ${categoryIds.length} categories for playlist ${playlistId}`
            );

            // NOTE: Do NOT delete user favorites or recently viewed items here.
            // When refreshing an Xtream playlist we want to remove only the
            // imported categories and content so user-specific data (favorites,
            // recently viewed) is preserved.

            return { success: true };
        } catch (error) {
            console.error('Error deleting Xtream content:', error);
            throw error;
        }
    }
);

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
 * Search content
 */
ipcMain.handle(
    'DB_SEARCH_CONTENT',
    async (event, playlistId: string, searchTerm: string, types: string[]) => {
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
                        like(schema.content.title, `%${searchTerm}%`),
                        inArray(
                            schema.content.type,
                            types as Array<'live' | 'movie' | 'series'>
                        )
                    )
                )
                .limit(50);
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
                    and(
                        like(
                            sql`LOWER(${schema.content.title})`,
                            `%${searchTerm.toLowerCase()}%`
                        ),
                        inArray(
                            schema.content.type,
                            types as Array<'live' | 'movie' | 'series'>
                        )
                    )
                )
                .orderBy(schema.content.title)
                .limit(50);
            return result;
        } catch (error) {
            console.error('Error in global search:', error);
            throw error;
        }
    }
);

/**
 * Get recently viewed items
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
 * Clear recently viewed items
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
            .innerJoin(
                schema.categories,
                eq(schema.content.categoryId, schema.categories.id)
            )
            .where(eq(schema.categories.playlistId, playlistId))
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
