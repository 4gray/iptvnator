import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type {
    XtreamBackupFavoriteItem,
    XtreamBackupHiddenCategory,
    XtreamBackupRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import {
    checkpointOperation,
    chunkValues,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';

const DEFAULT_BATCH_SIZE = 100;

type ContentIdentity = {
    id: number;
    xtreamId: number;
    contentType: XtreamBackupFavoriteItem['contentType'];
};

function toContentIdentityKey(
    contentType: XtreamBackupFavoriteItem['contentType'],
    xtreamId: number
): string {
    return `${contentType}:${xtreamId}`;
}

export async function deleteXtreamContent(
    db: AppDatabase,
    playlistId: string,
    control?: OperationControl
): Promise<{
    success: boolean;
    favorites: XtreamBackupFavoriteItem[];
    recentlyViewed: XtreamBackupRecentlyViewedItem[];
    hiddenCategories: XtreamBackupHiddenCategory[];
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
            categoryType: category.type,
        }));

    let favorites: XtreamBackupFavoriteItem[] = [];
    let recentlyViewed: XtreamBackupRecentlyViewedItem[] = [];

    if (categoryIds.length > 0) {
        const favoritedContent = await db
            .select({
                xtreamId: schema.content.xtreamId,
                contentType: schema.content.type,
                addedAt: schema.favorites.addedAt,
                position: schema.favorites.position,
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

        favorites = favoritedContent.map((favorite) => ({
            xtreamId: favorite.xtreamId,
            contentType: favorite.contentType,
            addedAt: favorite.addedAt ?? undefined,
            position: favorite.position,
        }));

        const recentlyViewedContent = await db
            .select({
                xtreamId: schema.content.xtreamId,
                contentType: schema.content.type,
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

        recentlyViewed = recentlyViewedContent.map((item) => ({
            xtreamId: item.xtreamId,
            contentType: item.contentType,
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
            await db.transaction((tx) => {
                tx
                    .delete(schema.content)
                    .where(inArray(schema.content.id, chunk))
                    .run();
            });
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
        await db.transaction((tx) => {
            tx
                .delete(schema.categories)
                .where(inArray(schema.categories.id, chunk))
                .run();
        });
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
        favorites,
        recentlyViewed,
        hiddenCategories,
    };
}

async function getContentIdentityMap(
    db: AppDatabase,
    playlistId: string,
    identities: Array<{
        contentType: XtreamBackupFavoriteItem['contentType'];
        xtreamId: number;
    }>
): Promise<Map<string, number>> {
    const xtreamIds = Array.from(
        new Set(identities.map((item) => item.xtreamId))
    );

    if (xtreamIds.length === 0) {
        return new Map();
    }

    const content = await db
        .select({
            id: schema.content.id,
            xtreamId: schema.content.xtreamId,
            contentType: schema.content.type,
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

    return new Map(
        content.map((item: ContentIdentity) => [
            toContentIdentityKey(item.contentType, item.xtreamId),
            item.id,
        ])
    );
}

export async function restoreXtreamUserData(
    db: AppDatabase,
    playlistId: string,
    favorites: XtreamBackupFavoriteItem[],
    recentlyViewed: XtreamBackupRecentlyViewedItem[],
    control?: OperationControl
): Promise<{ success: boolean }> {
    await checkpointOperation(control);
    await db
        .delete(schema.favorites)
        .where(eq(schema.favorites.playlistId, playlistId));

    await checkpointOperation(control);
    await db
        .delete(schema.recentlyViewed)
        .where(eq(schema.recentlyViewed.playlistId, playlistId));

    const contentByIdentity = await getContentIdentityMap(db, playlistId, [
        ...favorites.map((item) => ({
            contentType: item.contentType,
            xtreamId: item.xtreamId,
        })),
        ...recentlyViewed.map((item) => ({
            contentType: item.contentType,
            xtreamId: item.xtreamId,
        })),
    ]);

    const favoriteValues = favorites
        .map((item, index) => {
            const contentId = contentByIdentity.get(
                toContentIdentityKey(item.contentType, item.xtreamId)
            );

            if (!contentId) {
                return null;
            }

            return {
                contentId,
                playlistId,
                addedAt: item.addedAt ?? new Date().toISOString(),
                position: item.position ?? index,
            };
        })
        .filter(
            (
                value
            ): value is {
                contentId: number;
                playlistId: string;
                addedAt: string;
                position: number | null;
            } => value !== null
        );

    let restoredFavorites = 0;
    const totalFavorites = favoriteValues.length;

    for (const chunk of chunkValues(favoriteValues, DEFAULT_BATCH_SIZE)) {
        await checkpointOperation(control);
        await db.transaction((tx) => {
            tx.insert(schema.favorites).values(chunk).run();
        });
        restoredFavorites += chunk.length;
        await reportOperationProgress(control, {
            phase: 'restoring-favorites',
            current: restoredFavorites,
            total: totalFavorites,
            increment: chunk.length,
        });
    }

    const recentlyViewedValues = recentlyViewed
        .map((item) => {
            const contentId = contentByIdentity.get(
                toContentIdentityKey(item.contentType, item.xtreamId)
            );

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

    let restoredRecentlyViewed = 0;
    const totalRecentlyViewed = recentlyViewedValues.length;

    for (const chunk of chunkValues(recentlyViewedValues, DEFAULT_BATCH_SIZE)) {
        await checkpointOperation(control);
        await db.transaction((tx) => {
            tx.insert(schema.recentlyViewed).values(chunk).run();
        });
        restoredRecentlyViewed += chunk.length;
        await reportOperationProgress(control, {
            phase: 'restoring-recently-viewed',
            current: restoredRecentlyViewed,
            total: totalRecentlyViewed,
            increment: chunk.length,
        });
    }

    return { success: true };
}
