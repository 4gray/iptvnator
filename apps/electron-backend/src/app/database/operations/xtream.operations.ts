import { and, eq, inArray } from 'drizzle-orm';
import * as schema from 'database-schema';
import type { AppDatabase } from '../database.types';
import {
    checkpointOperation,
    chunkValues,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';

const DEFAULT_BATCH_SIZE = 100;

export async function deleteXtreamContent(
    db: AppDatabase,
    playlistId: string,
    control?: OperationControl
): Promise<{
    success: boolean;
    favoritedXtreamIds: number[];
    recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[];
    hiddenCategories: { xtreamId: number; type: string }[];
}> {
    const categories = await db
        .select({
            id: schema.categories.id,
            xtreamId: schema.categories.xtreamId,
            type: schema.categories.type,
            hidden: schema.categories.hidden,
        })
        .from(schema.categories)
        .where(eq(schema.categories.playlistId, playlistId));

    const categoryIds = categories.map((category) => category.id);
    const hiddenCategories = categories
        .filter((category) => category.hidden)
        .map((category) => ({
            xtreamId: category.xtreamId,
            type: category.type,
        }));

    let favoritedXtreamIds: number[] = [];
    let recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[] = [];

    if (categoryIds.length > 0) {
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

        favoritedXtreamIds = favorites.map((favorite) => favorite.xtreamId);

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

        recentlyViewedXtreamIds = recentlyViewed.map((item) => ({
            xtreamId: item.xtreamId,
            viewedAt: item.viewedAt || new Date().toISOString(),
        }));

        const contentRows = await db
            .select({ id: schema.content.id })
            .from(schema.content)
            .where(inArray(schema.content.categoryId, categoryIds));

        let deletedContent = 0;
        const totalContent = contentRows.length;

        for (const chunk of chunkValues(
            contentRows.map((content) => content.id),
            DEFAULT_BATCH_SIZE
        )) {
            await checkpointOperation(control);
            await db
                .delete(schema.content)
                .where(inArray(schema.content.id, chunk));
            deletedContent += chunk.length;
            await reportOperationProgress(control, {
                phase: 'deleting-content',
                current: deletedContent,
                total: totalContent,
                increment: chunk.length,
            });
        }
    }

    let deletedCategories = 0;
    const totalCategories = categoryIds.length;

    for (const chunk of chunkValues(categoryIds, DEFAULT_BATCH_SIZE)) {
        await checkpointOperation(control);
        await db
            .delete(schema.categories)
            .where(inArray(schema.categories.id, chunk));
        deletedCategories += chunk.length;
        await reportOperationProgress(control, {
            phase: 'deleting-categories',
            current: deletedCategories,
            total: totalCategories,
            increment: chunk.length,
        });
    }

    return {
        success: true,
        favoritedXtreamIds,
        recentlyViewedXtreamIds,
        hiddenCategories,
    };
}

export async function restoreXtreamUserData(
    db: AppDatabase,
    playlistId: string,
    favoritedXtreamIds: number[],
    recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[],
    control?: OperationControl
): Promise<{ success: boolean }> {
    if (favoritedXtreamIds.length > 0) {
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

        let currentFavorites = 0;
        const totalFavorites = content.length;

        for (const chunk of chunkValues(content, DEFAULT_BATCH_SIZE)) {
            await checkpointOperation(control);
            await db.insert(schema.favorites).values(
                chunk.map((item) => ({
                    contentId: item.id,
                    playlistId,
                    addedAt: new Date().toISOString(),
                }))
            );
            currentFavorites += chunk.length;
            await reportOperationProgress(control, {
                phase: 'restoring-favorites',
                current: currentFavorites,
                total: totalFavorites,
                increment: chunk.length,
            });
        }
    }

    if (recentlyViewedXtreamIds.length > 0) {
        const xtreamIds = recentlyViewedXtreamIds.map((item) => item.xtreamId);
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

        const xtreamIdToContentId = new Map(
            content.map((item) => [item.xtreamId, item.id])
        );

        const values = recentlyViewedXtreamIds
            .map((item) => {
                const contentId = xtreamIdToContentId.get(item.xtreamId);
                if (!contentId) {
                    return null;
                }

                return {
                    contentId,
                    playlistId,
                    viewedAt: item.viewedAt,
                };
            })
            .filter(
                (
                    value
                ): value is {
                    contentId: number;
                    playlistId: string;
                    viewedAt: string;
                } => value !== null
            );

        let currentRecentlyViewed = 0;
        const totalRecentlyViewed = values.length;

        for (const chunk of chunkValues(values, DEFAULT_BATCH_SIZE)) {
            await checkpointOperation(control);
            await db.insert(schema.recentlyViewed).values(chunk);
            currentRecentlyViewed += chunk.length;
            await reportOperationProgress(control, {
                phase: 'restoring-recently-viewed',
                current: currentRecentlyViewed,
                total: totalRecentlyViewed,
                increment: chunk.length,
            });
        }
    }

    return { success: true };
}
