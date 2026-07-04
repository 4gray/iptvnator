import { and, eq } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { TmdbCacheEntry, TmdbMediaType } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

export async function getTmdbMetadata(
    db: AppDatabase,
    mediaType: TmdbMediaType,
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
