import { eq, inArray, like } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    parseXtreamCategoryVisibility,
    XTREAM_CATEGORY_VISIBILITY_PREFIX,
    xtreamCategoryVisibilityKey,
    type XtreamCategoryVisibility,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

type VisibilityDatabase = Pick<
    AppDatabase,
    'select' | 'insert' | 'update' | 'delete'
>;
const identity = (row: { categoryType: string; xtreamId: number }) =>
    `${row.categoryType}:${row.xtreamId}`;

function readVisibility(db: Pick<AppDatabase, 'select'>, playlistId: string) {
    const row = db
        .select()
        .from(schema.appState)
        .where(eq(schema.appState.key, xtreamCategoryVisibilityKey(playlistId)))
        .get();
    return row?.value
        ? parseXtreamCategoryVisibility(row.value).categories
        : [];
}

/** Native rows and the explicit choices commit together, even across process exit. */
export function updateExplicitCategoryVisibility(
    db: AppDatabase,
    ids: number[],
    hidden: boolean
): void {
    if (typeof hidden !== 'boolean')
        throw new Error('Invalid category visibility.');
    const requested = [...new Set(ids)];
    db.transaction((tx) => {
        const groups = new Map<
            string,
            XtreamCategoryVisibility['categories']
        >();
        for (let offset = 0; offset < requested.length; offset += 1000) {
            const batch = requested.slice(offset, offset + 1000);
            const rows = tx
                .select()
                .from(schema.categories)
                .where(inArray(schema.categories.id, batch))
                .all();
            if (rows.length !== batch.length)
                throw new Error('Selected categories are no longer available.');
            tx.update(schema.categories)
                .set({ hidden })
                .where(inArray(schema.categories.id, batch))
                .run();
            for (const row of rows) {
                const values = groups.get(row.playlistId) ?? [];
                values.push({
                    categoryType: row.type,
                    xtreamId: row.xtreamId,
                    hidden,
                });
                groups.set(row.playlistId, values);
            }
        }
        for (const [playlistId, changed] of groups) {
            const state: XtreamCategoryVisibility = {
                version: 1,
                categories: [
                    ...new Map(
                        [...readVisibility(tx, playlistId), ...changed].map(
                            (row) => [identity(row), row]
                        )
                    ).values(),
                ],
            };
            const record = {
                key: xtreamCategoryVisibilityKey(playlistId),
                value: JSON.stringify(state),
                updatedAt: new Date().toISOString(),
            };
            tx.insert(schema.appState)
                .values(record)
                .onConflictDoUpdate({
                    target: schema.appState.key,
                    set: record,
                })
                .run();
        }
    });
}

/** Only explicit native choices may override defaults from an interrupted import. */
export function applyExplicitCategoryVisibility<
    T extends {
        type: string;
        xtreamId: number;
        hidden?: boolean;
    },
>(db: Pick<AppDatabase, 'select'>, playlistId: string, values: T[]): T[] {
    const choices = new Map(
        readVisibility(db, playlistId).map((row) => [identity(row), row.hidden])
    );
    return values.map((row) => {
        const hidden = choices.get(`${row.type}:${row.xtreamId}`);
        return hidden === undefined ? row : { ...row, hidden };
    });
}

export function deleteExplicitCategoryVisibility(
    db: Pick<VisibilityDatabase, 'delete'>,
    playlistId?: string
): void {
    db.delete(schema.appState)
        .where(
            playlistId
                ? eq(
                      schema.appState.key,
                      xtreamCategoryVisibilityKey(playlistId)
                  )
                : like(
                      schema.appState.key,
                      XTREAM_CATEGORY_VISIBILITY_PREFIX + '%'
                  )
        )
        .run();
}
