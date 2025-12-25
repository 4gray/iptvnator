/**
 * Xtream-specific IPC event handlers
 * Operations for refreshing and managing Xtream playlist data
 */

import { and, eq, inArray } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

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

            // Before deleting content, save xtreamIds of favorited and recently viewed items
            // so they can be restored after refresh
            let favoritedXtreamIds: number[] = [];
            let recentlyViewedXtreamIds: {
                xtreamId: number;
                viewedAt: string;
            }[] = [];

            if (categoryIds.length > 0) {
                // Get favorites with their xtreamIds
                const favorites = await db
                    .select({
                        xtreamId: schema.content.xtreamId,
                    })
                    .from(schema.favorites)
                    .innerJoin(
                        schema.content,
                        eq(schema.favorites.contentId, schema.content.id)
                    )
                    .where(
                        and(
                            eq(schema.favorites.playlistId, playlistId),
                            inArray(schema.content.categoryId, categoryIds)
                        )
                    );

                favoritedXtreamIds = favorites.map((f) => f.xtreamId);

                // Get recently viewed with their xtreamIds and timestamps
                const recentlyViewed = await db
                    .select({
                        xtreamId: schema.content.xtreamId,
                        viewedAt: schema.recentlyViewed.viewedAt,
                    })
                    .from(schema.recentlyViewed)
                    .innerJoin(
                        schema.content,
                        eq(schema.recentlyViewed.contentId, schema.content.id)
                    )
                    .where(
                        and(
                            eq(schema.recentlyViewed.playlistId, playlistId),
                            inArray(schema.content.categoryId, categoryIds)
                        )
                    );

                recentlyViewedXtreamIds = recentlyViewed.map((rv) => ({
                    xtreamId: rv.xtreamId,
                    viewedAt: rv.viewedAt || new Date().toISOString(),
                }));

                // Delete all content for these categories
                // (This will cascade delete favorites and recently viewed)
                await db
                    .delete(schema.content)
                    .where(inArray(schema.content.categoryId, categoryIds));
            }

            // Delete all categories for this playlist
            await db
                .delete(schema.categories)
                .where(eq(schema.categories.playlistId, playlistId));

            // Return the saved xtreamIds so favorites and recently viewed can be restored
            return {
                success: true,
                favoritedXtreamIds,
                recentlyViewedXtreamIds,
            };
        } catch (error) {
            console.error('Error deleting Xtream content:', error);
            throw error;
        }
    }
);

/**
 * Restore favorites and recently viewed items after Xtream refresh
 * Matches content by xtreamId and re-creates favorites/recently viewed entries
 */
ipcMain.handle(
    'DB_RESTORE_XTREAM_USER_DATA',
    async (
        event,
        playlistId: string,
        favoritedXtreamIds: number[],
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[]
    ) => {
        try {
            const db = await getDatabase();

            // Restore favorites
            if (favoritedXtreamIds.length > 0) {
                // Find content IDs for the xtreamIds
                const content = await db
                    .select({
                        id: schema.content.id,
                        xtreamId: schema.content.xtreamId,
                    })
                    .from(schema.content)
                    .innerJoin(
                        schema.categories,
                        eq(schema.content.categoryId, schema.categories.id)
                    )
                    .where(
                        and(
                            eq(schema.categories.playlistId, playlistId),
                            inArray(schema.content.xtreamId, favoritedXtreamIds)
                        )
                    );

                // Re-create favorite entries
                for (const item of content) {
                    await db.insert(schema.favorites).values({
                        contentId: item.id,
                        playlistId: playlistId,
                        addedAt: new Date().toISOString(),
                    });
                }
            }

            // Restore recently viewed
            if (recentlyViewedXtreamIds.length > 0) {
                const xtreamIds = recentlyViewedXtreamIds.map(
                    (rv) => rv.xtreamId
                );

                // Find content IDs for the xtreamIds
                const content = await db
                    .select({
                        id: schema.content.id,
                        xtreamId: schema.content.xtreamId,
                    })
                    .from(schema.content)
                    .innerJoin(
                        schema.categories,
                        eq(schema.content.categoryId, schema.categories.id)
                    )
                    .where(
                        and(
                            eq(schema.categories.playlistId, playlistId),
                            inArray(schema.content.xtreamId, xtreamIds)
                        )
                    );

                // Create a map of xtreamId -> contentId
                const xtreamIdToContentId = new Map(
                    content.map((item) => [item.xtreamId, item.id])
                );

                // Re-create recently viewed entries with original timestamps
                for (const item of recentlyViewedXtreamIds) {
                    const contentId = xtreamIdToContentId.get(item.xtreamId);
                    if (contentId) {
                        await db.insert(schema.recentlyViewed).values({
                            contentId: contentId,
                            playlistId: playlistId,
                            viewedAt: item.viewedAt,
                        });
                    }
                }
            }

            return { success: true };
        } catch (error) {
            console.error('Error restoring Xtream user data:', error);
            throw error;
        }
    }
);
