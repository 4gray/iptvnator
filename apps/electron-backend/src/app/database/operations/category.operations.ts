import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from 'database-schema';
import { repairMojibakeText } from 'shared-interfaces';
import type { AppDatabase } from '../database.types';
import { chunkValues } from './operation-control';

type XtreamCategoryInput = {
    category_name: string;
    category_id: string | number;
};

function normalizeXtreamCategoryId(rawCategoryId: string | number): number | null {
    const xtreamId = Number.parseInt(String(rawCategoryId), 10);

    return Number.isNaN(xtreamId) ? null : xtreamId;
}

function normalizeCategoryRow<T extends { name: string }>(row: T): T {
    return {
        ...row,
        name: repairMojibakeText(row.name),
    };
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
    const rows = await db
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

    return rows.map((row) => normalizeCategoryRow(row));
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

    const hiddenSet = new Set(hiddenCategoryXtreamIds || []);
    const values = categories.flatMap((category) => {
        const xtreamId = normalizeXtreamCategoryId(category.category_id);

        if (xtreamId === null) {
            return [];
        }

        return [
            {
                playlistId,
                name: repairMojibakeText(category.category_name),
                type,
                xtreamId,
                hidden: hiddenSet.has(xtreamId),
            },
        ];
    });

    if (values.length === 0) {
        return { success: true };
    }

    const existingCategories = await db
        .select({
            id: schema.categories.id,
            xtreamId: schema.categories.xtreamId,
        })
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type)
            )
        );
    const incomingXtreamIds = new Set(values.map((value) => value.xtreamId));
    const staleCategoryIds = existingCategories
        .filter((category) => !incomingXtreamIds.has(category.xtreamId))
        .map((category) => category.id);

    await db.transaction((tx) => {
        for (const row of values) {
            tx.insert(schema.categories)
                .values(row)
                .onConflictDoUpdate({
                    target: [
                        schema.categories.playlistId,
                        schema.categories.type,
                        schema.categories.xtreamId,
                    ],
                    set:
                        hiddenCategoryXtreamIds === undefined
                            ? {
                                  name: row.name,
                              }
                            : {
                                  name: row.name,
                                  hidden: row.hidden,
                              },
                })
                .run();
        }
    });

    for (const chunk of chunkValues(staleCategoryIds, 100)) {
        await db.transaction((tx) => {
            tx.delete(schema.categories)
                .where(inArray(schema.categories.id, chunk))
                .run();
        });
    }

    return { success: true };
}

export async function getAllCategories(
    db: AppDatabase,
    playlistId: string,
    type: 'live' | 'movies' | 'series'
) {
    const rows = await db
        .select()
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type)
            )
        )
        .orderBy(sql`name COLLATE NOCASE`);

    return rows.map((row) => normalizeCategoryRow(row));
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
