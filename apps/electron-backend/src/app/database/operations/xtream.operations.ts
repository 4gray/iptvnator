import { reconcileFavoriteIdentity } from './favorite-catalog';
import { restoreXtreamFavorites } from './favorite-restore';
import { replayRecoveredHistory } from './xtream-history-recovery';
export { restoreXtreamFavorites } from './favorite-restore';
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    XTREAM_DATABASE_PERFORMANCE_PHASE,
    normalizeXtreamContentTypes,
    type XtreamContentType,
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
    playlistId: string,
    types?: XtreamContentType[]
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

    const enabled = normalizeXtreamContentTypes(types);
    const allCategoryIds = categories.map((category) => category.id);
    const categoryIds = categories
        .filter((category) =>
            enabled.includes(
                category.type === 'movies' ? 'movie' : category.type
            )
        )
        .map((category) => category.id);
    const hiddenCategories = categories
        .filter((category) => category.hidden)
        .map((category) => ({
            xtreamId: category.xtreamId,
            categoryType: category.type,
        }));

    const favorites: XtreamBackupFavoriteItem[] = [];
    let recentlyViewed: XtreamBackupRecentlyViewedItem[] = [];
    let contentRowCounts: CategoryRowCount[] = [];

    if (allCategoryIds.length > 0) {
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
                    inArray(schema.content.categoryId, allCategoryIds)
                )
            );

        recentlyViewed = recentlyViewedContent.map((item) => ({
            xtreamId: item.xtreamId,
            contentType: item.contentType,
            viewedAt: item.viewedAt || new Date().toISOString(),
        }));

        if (categoryIds.length > 0) {
            contentRowCounts = await countContentRowsByCategory(
                db,
                inArray(schema.categories.id, categoryIds)
            );
        }
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
 * the captured categories in one statement. Both stay scoped to the ids the
 * collection step read, never to the whole playlist: the worker serves other
 * requests between commits, so a newer import of the same playlist may have
 * created categories this refresh must not erase. Returns the number of
 * deletion candidates (content rows plus categories) for phase metadata.
 */
async function deleteCollectedXtreamRows(
    db: AppDatabase,
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
            inArray(schema.categories.id, collection.categoryIds)
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
    capturePhase?: DatabaseOperationPerformancePhaseCapture,
    types?: XtreamContentType[]
): Promise<{
    success: boolean;
    favorites: XtreamBackupFavoriteItem[];
    recentlyViewed: XtreamBackupRecentlyViewedItem[];
    hiddenCategories: XtreamBackupHiddenCategory[];
}> {
    await checkpointOperation(control);
    reconcileFavoriteIdentity(db, eq(schema.favorites.playlistId, playlistId));
    await db
        .update(schema.appState)
        .set({ value: 'idle' })
        .where(
            inArray(
                schema.appState.key,
                normalizeXtreamContentTypes(types).map(
                    (type) => `xtream-import-status:${playlistId}:${type}`
                )
            )
        );
    const collection = capturePhase
        ? await capturePhase.captureAsync(
              XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
              () => collectXtreamDeletionRows(db, playlistId, types),
              (result) => ({
                  itemCount:
                      sumCategoryRowCounts(result.contentRowCounts) +
                      result.categoryIds.length,
              })
          )
        : await collectXtreamDeletionRows(db, playlistId, types);

    if (capturePhase) {
        await capturePhase.captureAsync(
            XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
            () => deleteCollectedXtreamRows(db, collection, control),
            (itemCount) => ({ itemCount })
        );
    } else {
        await deleteCollectedXtreamRows(db, collection, control);
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
    }>,
    control?: OperationControl
): Promise<Map<string, number>> {
    const xtreamIds = Array.from(
        new Set(identities.map((item) => item.xtreamId))
    );

    if (xtreamIds.length === 0) {
        return new Map();
    }

    const result = new Map<string, number>();
    for (const ids of chunkValues(xtreamIds, DEFAULT_BATCH_SIZE)) {
        await checkpointOperation(control);
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
                    inArray(schema.content.xtreamId, ids)
                )
            );

        for (const item of content as ContentIdentity[]) {
            result.set(
                toContentIdentityKey(item.contentType, item.xtreamId),
                item.id
            );
        }
    }
    return result;
}

export async function restoreXtreamUserData(
    db: AppDatabase,
    playlistId: string,
    favorites: XtreamBackupFavoriteItem[],
    recentlyViewed: XtreamBackupRecentlyViewedItem[],
    control?: OperationControl
): Promise<{ success: boolean }> {
    await restoreXtreamFavorites(db, playlistId, favorites, control);

    await checkpointOperation(control);
    const recovered = replayRecoveredHistory(db, playlistId);
    if (recovered !== null) {
        await reportOperationProgress(control, {
            phase: 'restoring-recently-viewed',
            current: recovered,
            total: recovered,
            increment: recovered,
        });
        return { success: true };
    }
    const contentByIdentity = await getContentIdentityMap(
        db,
        playlistId,
        recentlyViewed.map((item) => ({
            contentType: item.contentType,
            xtreamId: item.xtreamId,
        })),
        control
    );
    await checkpointOperation(control);
    await db
        .delete(schema.recentlyViewed)
        .where(eq(schema.recentlyViewed.playlistId, playlistId));

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
