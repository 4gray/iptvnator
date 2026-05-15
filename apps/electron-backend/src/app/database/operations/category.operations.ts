import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';

type XtreamCategoryInput = {
    category_name: string;
    category_id: string | number;
};

function normalizeXtreamCategoryId(
    rawCategoryId: string | number
): number | null {
    const xtreamId = Number.parseInt(String(rawCategoryId), 10);

    return Number.isNaN(xtreamId) ? null : xtreamId;
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
    type: 'live' | 'movies' | 'series'
) {
    // Xtream categories are inserted once in provider order and existing
    // xtream IDs are preserved, so row id order represents server order.
    // If partial category re-inserts are added later, persist a provider
    // sort index instead of relying on the insertion id.
    return db
        .select()
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type),
                eq(schema.categories.hidden, false)
            )
        )
        .orderBy(schema.categories.id);
}

export async function saveCategories(
    db: AppDatabase,
    playlistId: string,
    categories: XtreamCategoryInput[],
    type: 'live' | 'movies' | 'series',
    hiddenCategoryXtreamIds?: number[]
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

    const hiddenSet = new Set(hiddenCategoryXtreamIds || []);
    const values = categories.flatMap((category) => {
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

    if (values.length === 0) {
        return { success: true };
    }

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

    return { success: true };
}

export async function getAllCategories(
    db: AppDatabase,
    playlistId: string,
    type: 'live' | 'movies' | 'series'
) {
    return db
        .select()
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
