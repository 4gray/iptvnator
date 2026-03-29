import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from 'database-schema';
import type { AppDatabase } from '../database.types';

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
        .orderBy(sql`name COLLATE NOCASE`);
}

export async function saveCategories(
    db: AppDatabase,
    playlistId: string,
    categories: Array<{
        category_name: string;
        category_id: number;
    }>,
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
    const values = categories.map((category) => ({
        playlistId,
        name: category.category_name,
        type,
        xtreamId: category.category_id,
        hidden: hiddenSet.has(category.category_id),
    }));

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
