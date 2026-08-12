import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import * as schema from '@iptvnator/shared/database/schema';
import {
    ContentMetadataPatch,
    normalizeContentMetadataPatch,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

/**
 * One patchable `content` column: the Drizzle field to write, how to
 * recognise that it holds no value yet, and what to put there.
 *
 * Text columns count `''` as absent — provider payloads routinely carry empty
 * strings where a field is unknown, and an empty backdrop is not a backdrop.
 * Integer columns only count SQL NULL; `0` cannot reach here, since the patch
 * normalizer rejects non-positive ids and out-of-range years.
 */
interface PatchableColumn {
    key: 'backdropUrl' | 'tmdbId' | 'releaseYear' | 'originalTitle';
    column: SQLiteColumn;
    value: string | number;
    isText: boolean;
}

function patchableColumns(patch: ContentMetadataPatch): PatchableColumn[] {
    const candidates: PatchableColumn[] = [
        {
            key: 'backdropUrl',
            column: schema.content.backdropUrl,
            value: patch.backdropUrl as string,
            isText: true,
        },
        {
            key: 'tmdbId',
            column: schema.content.tmdbId,
            value: patch.tmdbId as number,
            isText: false,
        },
        {
            key: 'releaseYear',
            column: schema.content.releaseYear,
            value: patch.releaseYear as number,
            isText: false,
        },
        {
            key: 'originalTitle',
            column: schema.content.originalTitle,
            value: patch.originalTitle as string,
            isText: true,
        },
    ];
    return candidates.filter(({ value }) => value !== undefined);
}

/** `col IS NULL` — plus `col = ''` for text columns */
function isAbsent({ column, isText }: PatchableColumn): SQL {
    return isText
        ? sql`(${column} IS NULL OR ${column} = '')`
        : sql`${column} IS NULL`;
}

/**
 * Fill in the facts an Xtream detail view learned about a `content` row,
 * one column at a time and only where the row has nothing yet.
 *
 * Per-column rather than per-row: enrichment supplies the pieces at different
 * times — the release date and original title arrive with the provider's
 * detail response, the TMDB id only once enrichment resolves one (and never,
 * if the user leaves enrichment off). A row-level "already populated" guard
 * would let whichever piece landed first block all the others forever.
 *
 * Existing values are never overwritten, so the first detail open wins and
 * repeat opens are no-ops. That is what makes this safe to call
 * unconditionally from the detail views' backfill effect.
 */
export async function persistContentMetadataIfMissing(
    db: AppDatabase,
    contentId: number,
    patch?: ContentMetadataPatch
): Promise<void> {
    const normalized = normalizeContentMetadataPatch(patch);
    if (!normalized) {
        return;
    }

    const columns = patchableColumns(normalized);
    // `or()` only returns undefined for an empty list, which a non-null
    // normalized patch rules out.
    const anyAbsent = or(...columns.map(isAbsent)) as SQL;

    await db
        .update(schema.content)
        .set(
            Object.fromEntries(
                columns.map(({ key, column, value }) => [
                    key,
                    // Every requested column is written in the one statement
                    // the `anyAbsent` guard admits, so a column that already
                    // holds a value must preserve it here — otherwise filling
                    // an empty neighbour would clobber it.
                    sql`COALESCE(NULLIF(${column}, ''), ${value})`,
                ])
            )
        )
        .where(and(eq(schema.content.id, contentId), anyAbsent));
}

export async function setContentMetadataIfMissing(
    db: AppDatabase,
    contentId: number,
    patch?: ContentMetadataPatch
): Promise<{ success: boolean }> {
    await persistContentMetadataIfMissing(db, contentId, patch);
    return { success: true };
}
