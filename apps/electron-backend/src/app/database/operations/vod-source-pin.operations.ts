import { eq, inArray } from 'drizzle-orm';
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

/**
 * Every pin pointing AT this playlist.
 *
 * A pin belongs to a movie but names one playlist, so the playlist it points
 * at is the one that owns it for backup purposes — exporting it anywhere else
 * would restore a preference for a portal that is not in the archive.
 */
export async function listVodSourcePinsForPlaylist(
    db: AppDatabase,
    playlistId: string
): Promise<VodSourcePin[]> {
    if (typeof playlistId !== 'string' || playlistId === '') {
        return [];
    }

    const rows = await db
        .select()
        .from(schema.vodSourcePins)
        .where(eq(schema.vodSourcePins.playlistId, playlistId));

    return rows.map(toPin);
}

/**
 * Store the pin and retire its old aliases as ONE unit.
 *
 * Split across two calls there is no honest answer to a half-failure: report
 * success and a surviving alias silently wins the next lookup; report failure
 * and the canonical row is already durable, so a later reopen selects the
 * source the UI said was rejected. A transaction removes the question.
 */
export async function setVodSourcePin(
    db: AppDatabase,
    pin: VodSourcePin,
    retireKeys: string[] = []
): Promise<{ success: boolean }> {
    const updatedAt = new Date().toISOString();
    const retire = (retireKeys ?? [])
        .filter(
            (key) =>
                typeof key === 'string' && key !== '' && key !== pin.matchKey
        )
        .slice(0, MAX_KEYS_PER_LOOKUP);

    const insert = db
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

    await db.transaction(() => {
        // `.run()`, not `.execute()`: on better-sqlite3 the latter defers the
        // write to a promise that never settles inside this synchronous
        // callback, so the statement would be a silent no-op.
        insert.run();

        if (retire.length > 0) {
            db.delete(schema.vodSourcePins)
                .where(inArray(schema.vodSourcePins.matchKey, retire))
                .run();
        }
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

/**
 * Drop every pin pointing at one playlist.
 *
 * NOT expressible through `clearVodSourcePin`: that takes match keys and caps
 * them at `MAX_KEYS_PER_LOOKUP` to bound an IN list, so a playlist with more
 * pinned movies than the cap would have had the rest silently survive — while
 * the call still reported success.
 */
export async function clearVodSourcePinsForPlaylist(
    db: AppDatabase,
    playlistId: string
): Promise<{ success: boolean }> {
    if (typeof playlistId !== 'string' || playlistId === '') {
        return { success: false };
    }

    await db
        .delete(schema.vodSourcePins)
        .where(eq(schema.vodSourcePins.playlistId, playlistId));

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
