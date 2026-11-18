import { eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    XTREAM_DATABASE_PERFORMANCE_PHASE,
    type XtreamContentType,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { deleteExplicitCategoryVisibility } from './category-visibility';
import {
    type CategoryRowCount,
    countContentRowsByCategory,
    deleteCategoriesWhere,
    deleteContentByCategoryGroups,
    sumCategoryRowCounts,
} from './catalog-deletion';
import { reconcileFavoriteIdentity } from './favorite-catalog';
import {
    checkpointOperation,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';
import type { DatabaseOperationPerformancePhaseCapture } from './performance-phase-capture';
import { deleteHistoryRecovery } from './xtream-history-recovery';

interface PlaylistDeletionCollection {
    readonly categoryIds: number[];
    /** Content rows per category, the unit the delete is batched by. */
    readonly contentRowCounts: CategoryRowCount[];
    readonly favoriteCount: number;
    readonly playbackPositionCount: number;
    readonly recentlyViewedCount: number;
}

const CONTENT_TYPE_OF_CATEGORY = {
    live: 'live',
    movies: 'movie',
    series: 'series',
} as const satisfies Record<
    (typeof schema.categories.$inferSelect)['type'],
    XtreamContentType
>;

type UserDataTable =
    | typeof schema.favorites
    | typeof schema.playbackPositions
    | typeof schema.recentlyViewed;

async function countPlaylistRows(
    db: AppDatabase,
    table: UserDataTable,
    playlistId: string
): Promise<number> {
    const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .where(eq(table.playlistId, playlistId));
    return rows[0]?.count ?? 0;
}

async function collectPlaylistDeletionRows(
    db: AppDatabase,
    playlistId: string
): Promise<PlaylistDeletionCollection> {
    const [favoriteCount, recentlyViewedCount, playbackPositionCount] =
        await Promise.all([
            countPlaylistRows(db, schema.favorites, playlistId),
            countPlaylistRows(db, schema.recentlyViewed, playlistId),
            countPlaylistRows(db, schema.playbackPositions, playlistId),
        ]);

    const categoryRows = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.playlistId, playlistId));
    const categoryIds = categoryRows.map((category) => category.id);
    const contentRowCounts =
        categoryIds.length > 0
            ? await countContentRowsByCategory(
                  db,
                  eq(schema.categories.playlistId, playlistId)
              )
            : [];

    return {
        categoryIds,
        contentRowCounts,
        favoriteCount,
        playbackPositionCount,
        recentlyViewedCount,
    };
}

function countPlaylistDeletionRows(
    collection: PlaylistDeletionCollection
): number {
    return (
        collection.favoriteCount +
        collection.recentlyViewedCount +
        collection.playbackPositionCount +
        sumCategoryRowCounts(collection.contentRowCounts) +
        collection.categoryIds.length
    );
}

/**
 * Before the first catalog commit, as a refresh does: favorites record their
 * identity evidence while their content still exists (they outlive it with
 * `content_id` NULL, and a completed re-import links them again). The
 * catalog's types are marked `importing`, the marker an interrupted import
 * leaves, so a cancelled delete is cleared and re-imported on the next open
 * instead of being shown as a complete, half-empty catalog.
 */
function prepareCancellableCatalogDelete(
    db: AppDatabase,
    playlistId: string
): void {
    db.transaction((tx) => {
        reconcileFavoriteIdentity(
            tx,
            eq(schema.favorites.playlistId, playlistId)
        );
        // Every type with categories, keyed or not: a catalog imported
        // before the status keys existed reads as `idle`, which bootstrap
        // would keep as a usable cache.
        const types = tx
            .selectDistinct({ type: schema.categories.type })
            .from(schema.categories)
            .where(eq(schema.categories.playlistId, playlistId))
            .all();
        const updatedAt = new Date().toISOString();
        for (const { type } of types) {
            const record = {
                key: `xtream-import-status:${playlistId}:${CONTENT_TYPE_OF_CATEGORY[type]}`,
                value: 'importing',
                updatedAt,
            };
            tx.insert(schema.appState)
                .values(record)
                .onConflictDoUpdate({
                    target: schema.appState.key,
                    set: { value: record.value, updatedAt },
                })
                .run();
        }
    });
}

/**
 * Removes the playlist's catalog in cancellable, row-budgeted commits, then
 * its user data and the playlist row in one final transaction.
 *
 * Cancellation is cooperative between commits, and committed batches stay
 * committed, so a cancel can only interrupt catalog work: favorites and
 * playback positions are deleted in the final transaction, after the last
 * checkpoint. A cancelled source keeps them; its catalog is re-imported on
 * the next open. Recently viewed rows cascade with their content, so a
 * cancelled source loses its history as an interrupted import does.
 */
async function deleteCollectedPlaylistRows(
    db: AppDatabase,
    playlistId: string,
    collection: PlaylistDeletionCollection,
    control?: OperationControl
): Promise<number> {
    const totalCategories = collection.categoryIds.length;
    if (totalCategories > 0) {
        await checkpointOperation(control);
        prepareCancellableCatalogDelete(db, playlistId);
    }

    await deleteContentByCategoryGroups(db, collection.contentRowCounts, {
        control,
        phase: 'deleting-content',
    });

    if (totalCategories > 0) {
        await checkpointOperation(control);
        const changes = await deleteCategoriesWhere(
            db,
            eq(schema.categories.playlistId, playlistId)
        );
        await reportOperationProgress(control, {
            phase: 'deleting-categories',
            current: changes,
            total: totalCategories,
            increment: changes,
        });
    }

    // The point of no return: no checkpoint runs after this one.
    await checkpointOperation(control);
    db.transaction((tx) => {
        for (const table of [
            schema.favorites,
            schema.recentlyViewed,
            schema.playbackPositions,
        ] as const) {
            tx.delete(table).where(eq(table.playlistId, playlistId)).run();
        }
        tx.delete(schema.playlists)
            .where(eq(schema.playlists.id, playlistId))
            .run();
        deleteHistoryRecovery(tx, playlistId);
        deleteExplicitCategoryVisibility(tx, playlistId);
    });

    // Progress after the commit must not checkpoint: a cancel arriving now
    // would report a delete that already happened as cancelled.
    for (const [phase, total] of [
        ['deleting-favorites', collection.favoriteCount],
        ['deleting-recently-viewed', collection.recentlyViewedCount],
        ['deleting-playback-positions', collection.playbackPositionCount],
        ['deleting-playlist', 1],
    ] as const) {
        if (total > 0) {
            await control?.onProgress?.({
                phase,
                current: total,
                total,
                increment: total,
            });
        }
    }

    return countPlaylistDeletionRows(collection) + 1;
}

export async function deletePlaylist(
    db: AppDatabase,
    playlistId: string,
    control?: OperationControl,
    capturePhase?: DatabaseOperationPerformancePhaseCapture
): Promise<{ success: boolean }> {
    const collection = capturePhase
        ? await capturePhase.captureAsync(
              XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
              () => collectPlaylistDeletionRows(db, playlistId),
              (result) => ({
                  itemCount: countPlaylistDeletionRows(result),
              })
          )
        : await collectPlaylistDeletionRows(db, playlistId);

    if (capturePhase) {
        await capturePhase.captureAsync(
            XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
            () =>
                deleteCollectedPlaylistRows(
                    db,
                    playlistId,
                    collection,
                    control
                ),
            (itemCount) => ({ itemCount })
        );
    } else {
        await deleteCollectedPlaylistRows(db, playlistId, collection, control);
    }

    return { success: true };
}
