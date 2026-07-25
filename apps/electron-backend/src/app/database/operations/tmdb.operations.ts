import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type {
    TmdbCacheEntry,
    TmdbCacheMediaType,
    TmdbCacheStats,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

export async function getTmdbMetadata(
    db: AppDatabase,
    mediaType: TmdbCacheMediaType,
    lookupKey: string,
    language: string
): Promise<TmdbCacheEntry | null> {
    const rows = await db
        .select()
        .from(schema.tmdbMetadata)
        .where(
            and(
                eq(schema.tmdbMetadata.mediaType, mediaType),
                eq(schema.tmdbMetadata.lookupKey, lookupKey),
                eq(schema.tmdbMetadata.language, language)
            )
        )
        .limit(1);

    const row = rows[0];
    if (!row) {
        return null;
    }

    return {
        mediaType: row.mediaType,
        lookupKey: row.lookupKey,
        language: row.language,
        tmdbId: row.tmdbId,
        payload: row.payload,
        fetchedAt: row.fetchedAt ?? undefined,
    };
}

export async function setTmdbMetadata(
    db: AppDatabase,
    entry: TmdbCacheEntry
): Promise<{ success: boolean }> {
    const fetchedAt = new Date().toISOString();

    await db
        .insert(schema.tmdbMetadata)
        .values({
            mediaType: entry.mediaType,
            lookupKey: entry.lookupKey,
            language: entry.language,
            tmdbId: entry.tmdbId,
            payload: entry.payload,
            fetchedAt,
        })
        .onConflictDoUpdate({
            target: [
                schema.tmdbMetadata.mediaType,
                schema.tmdbMetadata.lookupKey,
                schema.tmdbMetadata.language,
            ],
            set: {
                tmdbId: entry.tmdbId,
                payload: entry.payload,
                fetchedAt,
            },
        });

    return { success: true };
}

/**
 * Row count and payload size for the settings panel. `LENGTH()` on TEXT
 * counts CHARACTERS, so the cast to BLOB is what makes this bytes.
 * Negative-match rows have a NULL payload; SUM skips them.
 */
export async function getTmdbCacheStats(
    db: AppDatabase
): Promise<TmdbCacheStats> {
    const rows = (await db.all(sql`
        SELECT
            COUNT(*) AS entries,
            COALESCE(SUM(LENGTH(CAST(payload AS BLOB))), 0) AS bytes
        FROM tmdb_metadata
    `)) as { entries: number; bytes: number }[];

    return {
        entries: Number(rows[0]?.entries ?? 0),
        bytes: Number(rows[0]?.bytes ?? 0),
    };
}

/**
 * Drops the whole cache. Enrichment simply refetches on demand, so this
 * is always safe. Also the escape hatch when a lookup-key version bump
 * orphans rows: a bump makes them unreachable, not deleted.
 */
export async function clearTmdbMetadata(
    db: AppDatabase
): Promise<{ success: boolean; deleted: number }> {
    const { entries } = await getTmdbCacheStats(db);
    await db.run(sql`DELETE FROM tmdb_metadata`);
    return { success: true, deleted: entries };
}
