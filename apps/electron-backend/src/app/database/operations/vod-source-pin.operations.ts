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
 * Store the pin under every key that names this film, and retire its old
 * aliases, as ONE unit.
 *
 * `aliasKeys` exist because a movie's identity GROWS: the same film is
 * `title:dune:2021` before TMDB enrichment lands and `tmdb:438631` after, and
 * a decision recorded only under the richer key is invisible to the next
 * reopen that has not been enriched yet. Callers pass every key that names
 * exactly this one film — never the ambiguous yearless form, which every
 * remake shares.
 *
 * Split across two calls there is no honest answer to a half-failure: report
 * success and a surviving alias silently wins the next lookup; report failure
 * and the canonical row is already durable, so a later reopen selects the
 * source the UI said was rejected. A transaction removes the question.
 */
export async function setVodSourcePin(
    db: AppDatabase,
    pin: VodSourcePin,
    retireKeys: string[] = [],
    aliasKeys: string[] = []
): Promise<{ success: boolean }> {
    const updatedAt = new Date().toISOString();
    const write = [
        ...new Set(
            [pin.matchKey, ...(aliasKeys ?? [])].filter(
                (key) => typeof key === 'string' && key !== ''
            )
        ),
    ].slice(0, MAX_KEYS_PER_LOOKUP);

    // Nothing identifying to store it under. Reporting success here would
    // promise a preference that was never written.
    if (write.length === 0) {
        return { success: false };
    }

    const retire = (retireKeys ?? [])
        .filter(
            (key) =>
                typeof key === 'string' && key !== '' && !write.includes(key)
        )
        .slice(0, MAX_KEYS_PER_LOOKUP);

    const inserts = write.map((matchKey) =>
        db
            .insert(schema.vodSourcePins)
            .values({
                matchKey,
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
            })
    );

    await db.transaction(() => {
        // `.run()`, not `.execute()`: on better-sqlite3 the latter defers the
        // write to a promise that never settles inside this synchronous
        // callback, so the statement would be a silent no-op.
        for (const insert of inserts) {
            insert.run();
        }

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

/**
 * Make this playlist's pins exactly `pins`, in ONE transaction.
 *
 * Restore cannot do this as a clear followed by writes. If a write fails
 * partway the user's previous pins are already gone and only a prefix of the
 * archive has landed — the import reports failure, and the state it leaves
 * behind belongs to neither the backup nor what was there before. One
 * statement group means the playlist either ends up as the archive describes
 * it or exactly as it was.
 */
export async function replaceVodSourcePinsForPlaylist(
    db: AppDatabase,
    playlistId: string,
    pins: VodSourcePin[]
): Promise<{ success: boolean }> {
    if (typeof playlistId !== 'string' || playlistId === '') {
        return { success: false };
    }

    const updatedAt = new Date().toISOString();
    const rows = (pins ?? [])
        .filter(
            (pin) =>
                typeof pin?.matchKey === 'string' &&
                pin.matchKey !== '' &&
                Number.isInteger(pin?.contentId)
        )
        .map((pin) => ({
            matchKey: pin.matchKey,
            playlistId,
            contentId: pin.contentId,
            portalType: pin.portalType,
            updatedAt: pin.updatedAt ?? updatedAt,
        }));

    const inserts = rows.map((row) =>
        db
            .insert(schema.vodSourcePins)
            .values(row)
            .onConflictDoUpdate({
                target: schema.vodSourcePins.matchKey,
                set: {
                    playlistId: row.playlistId,
                    contentId: row.contentId,
                    portalType: row.portalType,
                    updatedAt: row.updatedAt,
                },
            })
    );

    await db.transaction(() => {
        db.delete(schema.vodSourcePins)
            .where(eq(schema.vodSourcePins.playlistId, playlistId))
            .run();

        for (const insert of inserts) {
            insert.run();
        }
    });

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
