import { inArray } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { VodSourcePin } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

/**
 * VOD multi-source pins — the user's per-movie choice of preferred playlist.
 *
 * Lookups take SEVERAL keys rather than one: a movie pinned before TMDB
 * enrichment landed is stored under its title key, and the same movie prefers
 * a `tmdb:` key afterwards. Reading both means the id arriving later does not
 * orphan an existing pin.
 */

/** Guards against an unbounded IN list if a caller ever passes junk. */
const MAX_KEYS_PER_LOOKUP = 8;

export async function getVodSourcePin(
    db: AppDatabase,
    matchKeys: string[]
): Promise<VodSourcePin | null> {
    const keys = (matchKeys ?? [])
        .filter((key) => typeof key === 'string' && key !== '')
        .slice(0, MAX_KEYS_PER_LOOKUP);

    if (keys.length === 0) {
        return null;
    }

    const rows = await db
        .select()
        .from(schema.vodSourcePins)
        .where(inArray(schema.vodSourcePins.matchKey, keys));

    if (rows.length === 0) {
        return null;
    }

    // Callers pass keys most-trusted first (tmdb before title), so honour that
    // order rather than whatever SQLite returned.
    for (const key of keys) {
        const row = rows.find((candidate) => candidate.matchKey === key);
        if (row) {
            return toPin(row);
        }
    }

    return null;
}

export async function setVodSourcePin(
    db: AppDatabase,
    pin: VodSourcePin
): Promise<{ success: boolean }> {
    const updatedAt = new Date().toISOString();

    await db
        .insert(schema.vodSourcePins)
        .values({
            matchKey: pin.matchKey,
            playlistId: pin.playlistId,
            contentId: pin.contentId,
            portalType: pin.portalType,
            updatedAt,
        })
        .onConflictDoUpdate({
            target: schema.vodSourcePins.matchKey,
            set: {
                playlistId: pin.playlistId,
                contentId: pin.contentId,
                portalType: pin.portalType,
                updatedAt,
            },
        });

    return { success: true };
}

export async function clearVodSourcePin(
    db: AppDatabase,
    matchKeys: string[]
): Promise<{ success: boolean }> {
    const keys = (matchKeys ?? [])
        .filter((key) => typeof key === 'string' && key !== '')
        .slice(0, MAX_KEYS_PER_LOOKUP);

    if (keys.length === 0) {
        return { success: false };
    }

    // Clears every alias of the movie, so unpinning is not undone by a stale
    // row under the other key form.
    await db
        .delete(schema.vodSourcePins)
        .where(inArray(schema.vodSourcePins.matchKey, keys));

    return { success: true };
}

function toPin(row: schema.VodSourcePinRow): VodSourcePin {
    return {
        matchKey: row.matchKey,
        playlistId: row.playlistId,
        contentId: row.contentId,
        portalType: row.portalType,
        updatedAt: row.updatedAt ?? undefined,
    };
}
