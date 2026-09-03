import type { SQL } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    type CategoryRowCount,
    CONTENT_ROWS_PER_TRANSACTION,
    deleteCategoriesWhere,
    deleteContentByCategoryGroups,
} from './catalog-deletion';
import { scoreSearchTextMatch } from './content-search.util';
import {
    checkpointOperation,
    chunkValues,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';

/**
 * Rows per multi-row INSERT. Drizzle binds one parameter per column an
 * `XtreamContentValue` supplies (eleven; the rest are emitted as `default`),
 * so a statement carries 1,100 parameters, well under SQLite's 32,766 limit.
 * A single statement for a whole 5,000-row commit would exceed it.
 */
const INSERT_ROWS_PER_STATEMENT = 100;
const INSERT_STATEMENTS_PER_TRANSACTION = Math.max(
    1,
    Math.floor(CONTENT_ROWS_PER_TRANSACTION / INSERT_ROWS_PER_STATEMENT)
);

export type XtreamContentValue = {
    categoryId: number;
    title: string;
    rating: string;
    added: string;
    posterUrl: string;
    epgChannelId?: string | null;
    tvArchive?: number | null;
    tvArchiveDuration?: number | null;
    directSource?: string | null;
    xtreamId: number;
    type: 'live' | 'movie' | 'series';
};

export function normalizeXtreamContentValues(
    streams: Array<Record<string, unknown>>,
    type: 'live' | 'movie' | 'series',
    categories: Array<{ id: number; xtreamId: number }>,
    normalizeValue: (
        stream: Record<string, unknown>,
        type: 'live' | 'movie' | 'series',
        categoryMap: Map<number, number>
    ) => XtreamContentValue | null
): XtreamContentValue[] {
    const categoryMap = new Map(
        categories.map((category) => [category.xtreamId, category.id])
    );

    return streams
        .map((stream) => normalizeValue(stream, type, categoryMap))
        .filter((value): value is XtreamContentValue => value !== null);
}

export async function writeXtreamContentValues(
    db: AppDatabase,
    values: XtreamContentValue[],
    control?: OperationControl
): Promise<{ success: boolean; count: number }> {
    const total = values.length;
    let totalInserted = 0;

    // One commit per CONTENT_ROWS_PER_TRANSACTION rows, made of
    // statement-sized chunks: see catalog-deletion.ts for why a commit every
    // 100 rows is the expensive part of a large import.
    for (const statements of chunkValues(
        chunkValues(values, INSERT_ROWS_PER_STATEMENT),
        INSERT_STATEMENTS_PER_TRANSACTION
    )) {
        await checkpointOperation(control);
        await db.transaction((tx) => {
            for (const chunk of statements) {
                tx.insert(schema.content)
                    .values(chunk)
                    .onConflictDoNothing({
                        target: [
                            schema.content.categoryId,
                            schema.content.type,
                            schema.content.xtreamId,
                        ],
                    })
                    .run();
            }
        });
        const inserted = statements.reduce(
            (count, chunk) => count + chunk.length,
            0
        );
        totalInserted += inserted;
        await reportOperationProgress(control, {
            phase: 'saving-content',
            current: totalInserted,
            total,
            increment: inserted,
        });
    }

    return { success: true, count: totalInserted };
}

/**
 * Drops one content type's cached catalog: content in row-budgeted category
 * groups, then the categories themselves. `categoryFilter` scopes both to the
 * playlist and type being re-imported.
 */
export async function deleteXtreamCacheRows(
    db: AppDatabase,
    contentRowCounts: readonly CategoryRowCount[],
    categoryFilter: SQL
): Promise<{ success: boolean }> {
    await deleteContentByCategoryGroups(db, contentRowCounts, {
        phase: 'deleting-content',
    });
    await deleteCategoriesWhere(db, categoryFilter);

    return { success: true };
}

export function rankSearchCandidates<
    TCandidate extends { title: string | null },
>(candidates: TCandidate[], searchTerm: string): TCandidate[] {
    return candidates
        .filter(
            (item) =>
                scoreSearchTextMatch(item.title ?? '', searchTerm) !== null
        )
        .slice(0, 50);
}
