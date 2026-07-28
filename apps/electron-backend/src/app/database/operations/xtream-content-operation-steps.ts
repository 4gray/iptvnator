import { inArray } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { scoreSearchTextMatch } from './content-search.util';
import {
    checkpointOperation,
    chunkValues,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';

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
    const chunkSize = 100;
    let totalInserted = 0;

    for (let index = 0; index < values.length; index += chunkSize) {
        await checkpointOperation(control);
        const chunk = values.slice(index, index + chunkSize);
        await db.transaction((tx) => {
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
        });
        totalInserted += chunk.length;
        await reportOperationProgress(control, {
            phase: 'saving-content',
            current: totalInserted,
            total,
            increment: chunk.length,
        });
    }

    return { success: true, count: totalInserted };
}

export async function deleteXtreamCacheRows(
    db: AppDatabase,
    contentRows: Array<{ id: number }>,
    categoryIds: number[]
): Promise<{ success: boolean }> {
    for (const chunk of chunkValues(
        contentRows.map((row) => row.id),
        100
    )) {
        await db.transaction((tx) => {
            tx.delete(schema.content)
                .where(inArray(schema.content.id, chunk))
                .run();
        });
    }

    for (const chunk of chunkValues(categoryIds, 100)) {
        await db.transaction((tx) => {
            tx.delete(schema.categories)
                .where(inArray(schema.categories.id, chunk))
                .run();
        });
    }

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
