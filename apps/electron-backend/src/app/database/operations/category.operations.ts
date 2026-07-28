import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import type { DatabaseOperationPerformancePhaseCapture } from './performance-phase-capture';

type XtreamCategoryInput = {
    category_name: string;
    category_id: string | number;
};

type XtreamCategoryValue = typeof schema.categories.$inferInsert;

// Category rows cross the DB-worker IPC boundary in the snake_case wire
// shape declared by XCategoryFromDb/XtreamCategoryFromDb. A bare select()
// would leak Drizzle's camelCase property names (xtreamId, playlistId)
// instead, silently breaking consumers such as the playlist backup
// export/restore (issue #1017).
const categoryWireShape = {
    id: schema.categories.id,
    playlist_id: schema.categories.playlistId,
    name: schema.categories.name,
    type: schema.categories.type,
    xtream_id: schema.categories.xtreamId,
    hidden: schema.categories.hidden,
};

function normalizeXtreamCategoryId(
    rawCategoryId: string | number
): number | null {
    const xtreamId = Number.parseInt(String(rawCategoryId), 10);

    return Number.isNaN(xtreamId) ? null : xtreamId;
}

function normalizeXtreamCategories(
    playlistId: string,
    categories: XtreamCategoryInput[],
    type: 'live' | 'movies' | 'series',
    hiddenCategoryXtreamIds?: number[]
): XtreamCategoryValue[] {
    const hiddenSet = new Set(hiddenCategoryXtreamIds || []);

    return categories.flatMap((category) => {
        const xtreamId = normalizeXtreamCategoryId(category.category_id);

        if (xtreamId === null) {
            return [];
        }

        return [
            {
                playlistId,
                name: category.category_name,
                type,
                xtreamId,
                hidden: hiddenSet.has(xtreamId),
            },
        ];
    });
}

async function insertXtreamCategories(
    db: AppDatabase,
    values: XtreamCategoryValue[]
): Promise<void> {
    await db
        .insert(schema.categories)
        .values(values)
        .onConflictDoNothing({
            target: [
                schema.categories.playlistId,
                schema.categories.type,
                schema.categories.xtreamId,
            ],
        });
}

export async function hasCategories(
    db: AppDatabase,
    playlistId: string,
    type: 'live' | 'movies' | 'series'
): Promise<boolean> {
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
}

export async function getCategories(
    db: AppDatabase,
    playlistId: string,
    type: 'live' | 'movies' | 'series',
    capturePhase?: DatabaseOperationPerformancePhaseCapture
) {
    // Xtream categories are inserted once in provider order and existing
    // xtream IDs are preserved, so row id order represents server order.
    // If partial category re-inserts are added later, persist a provider
    // sort index instead of relying on the insertion id.
    const query = db
        .select(categoryWireShape)
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type),
                eq(schema.categories.hidden, false)
            )
        )
        .orderBy(schema.categories.id);

    return capturePhase
        ? capturePhase.captureAsync(
              XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_READ,
              async () => query,
              (rows) => ({ itemCount: rows.length })
          )
        : query;
}

export async function saveCategories(
    db: AppDatabase,
    playlistId: string,
    categories: XtreamCategoryInput[],
    type: 'live' | 'movies' | 'series',
    hiddenCategoryXtreamIds?: number[],
    capturePhase?: DatabaseOperationPerformancePhaseCapture
): Promise<{ success: boolean }> {
    if (!categories || categories.length === 0) {
        return { success: true };
    }

    const existingCategories = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type)
            )
        );

    if ((existingCategories[0]?.count ?? 0) > 0) {
        return { success: true };
    }

    const values = capturePhase
        ? capturePhase.captureSync(
              XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_CATEGORIES,
              () =>
                  normalizeXtreamCategories(
                      playlistId,
                      categories,
                      type,
                      hiddenCategoryXtreamIds
                  ),
              (result) => ({ itemCount: result.length })
          )
        : normalizeXtreamCategories(
              playlistId,
              categories,
              type,
              hiddenCategoryXtreamIds
          );

    if (values.length === 0) {
        return { success: true };
    }

    if (capturePhase) {
        await capturePhase.captureAsync(
            XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
            () => insertXtreamCategories(db, values),
            () => ({ itemCount: values.length })
        );
    } else {
        await insertXtreamCategories(db, values);
    }

    return { success: true };
}

export async function getAllCategories(
    db: AppDatabase,
    playlistId: string,
    type: 'live' | 'movies' | 'series'
) {
    return db
        .select(categoryWireShape)
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type)
            )
        )
        .orderBy(sql`name COLLATE NOCASE`);
}

export async function updateCategoryVisibility(
    db: AppDatabase,
    categoryIds: number[],
    hidden: boolean
): Promise<{ success: boolean }> {
    if (categoryIds.length === 0) {
        return { success: true };
    }

    await db
        .update(schema.categories)
        .set({ hidden })
        .where(inArray(schema.categories.id, categoryIds));

    return { success: true };
}
