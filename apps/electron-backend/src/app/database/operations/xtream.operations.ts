import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    XTREAM_DATABASE_PERFORMANCE_PHASE,
    type XtreamBackupFavoriteItem,
    type XtreamBackupHiddenCategory,
    type XtreamBackupRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import {
    type CategoryRowCount,
    countContentRowsByCategory,
    deleteCategoriesWhere,
    deleteContentByCategoryGroups,
    sumCategoryRowCounts,
} from './catalog-deletion';
import {
    checkpointOperation,
    chunkValues,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';
import type { DatabaseOperationPerformancePhaseCapture } from './performance-phase-capture';

/** Favorites and recently-viewed rows restored per transaction. */
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

interface XtreamDeletionCollection {
    readonly categoryIds: number[];
    /** Content rows per category, the unit the delete is batched by. */
    readonly contentRowCounts: CategoryRowCount[];
    readonly favorites: XtreamBackupFavoriteItem[];
    readonly hiddenCategories: XtreamBackupHiddenCategory[];
    readonly recentlyViewed: XtreamBackupRecentlyViewedItem[];
}

async function collectXtreamDeletionRows(
    db: AppDatabase,
    playlistId: string
): Promise<XtreamDeletionCollection> {
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
    let contentRowCounts: CategoryRowCount[] = [];

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

        contentRowCounts = await countContentRowsByCategory(
            db,
            eq(schema.categories.playlistId, playlistId)
        );
    }

    return {
        categoryIds,
        contentRowCounts,
        favorites,
        hiddenCategories,
        recentlyViewed,
    };
}

/**
 * Drops the collected catalog: content in row-budgeted category groups, then
 * every category of the playlist in one statement. Returns the number of
 * deletion candidates (content rows plus categories) for phase metadata.
 */
async function deleteCollectedXtreamRows(
    db: AppDatabase,
    playlistId: string,
    collection: XtreamDeletionCollection,
    control?: OperationControl
): Promise<number> {
    await deleteContentByCategoryGroups(db, collection.contentRowCounts, {
        control,
        phase: 'deleting-content',
    });

    const totalCategories = collection.categoryIds.length;
    if (totalCategories > 0) {
        await checkpointOperation(control);
        const deletedCategories = await deleteCategoriesWhere(
            db,
            eq(schema.categories.playlistId, playlistId)
        );
        await reportOperationProgress(control, {
            phase: 'deleting-categories',
            current: deletedCategories,
            total: totalCategories,
            increment: deletedCategories,
        });
    }

    return sumCategoryRowCounts(collection.contentRowCounts) + totalCategories;
}

export async function deleteXtreamContent(
    db: AppDatabase,
    playlistId: string,
    control?: OperationControl,
    capturePhase?: DatabaseOperationPerformancePhaseCapture
): Promise<{
    success: boolean;
    favorites: XtreamBackupFavoriteItem[];
    recentlyViewed: XtreamBackupRecentlyViewedItem[];
    hiddenCategories: XtreamBackupHiddenCategory[];
}> {
    const collection = capturePhase
        ? await capturePhase.captureAsync(
              XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
              () => collectXtreamDeletionRows(db, playlistId),
              (result) => ({
                  itemCount:
                      sumCategoryRowCounts(result.contentRowCounts) +
                      result.categoryIds.length,
              })
          )
        : await collectXtreamDeletionRows(db, playlistId);

    if (capturePhase) {
        await capturePhase.captureAsync(
            XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
            () =>
                deleteCollectedXtreamRows(db, playlistId, collection, control),
            (itemCount) => ({ itemCount })
        );
    } else {
        await deleteCollectedXtreamRows(db, playlistId, collection, control);
    }

    return {
        success: true,
        favorites: collection.favorites,
        recentlyViewed: collection.recentlyViewed,
        hiddenCategories: collection.hiddenCategories,
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
