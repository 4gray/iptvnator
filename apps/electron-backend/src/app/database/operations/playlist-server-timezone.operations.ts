/**
 * The panel clock an Xtream account-info check learns (`serverTimezone`)
 * lives in the playlist row's JSON payload — it has no column — and every
 * write that touches it must stay atomic against the row's CURRENT
 * connection, because the database worker interleaves requests and the
 * Xtream edit dialog saves through `DB_UPDATE_PLAYLIST` outside
 * `PlaylistsService`'s queue (issue #1562). This module owns the three SQL
 * shapes and the one projection the playlist operations compose:
 *
 * - `setPlaylistServerTimezone`: record a learned clock, conditionally.
 * - `serverTimezoneInvalidation`: drop it when an update moves the source.
 * - `playlistConflictUpdate`: keep it across a clockless full upsert.
 * - `readPayloadServerTimezone`: surface it on a raw row read.
 */

import { sql, type SQL } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';

export {
    playlistConflictUpdate,
    readPayloadServerTimezone,
    type PlaylistConflictUpdate,
} from '@iptvnator/shared/database/app-playlist';

export interface PlaylistConnectionIdentity {
    serverUrl: string;
    username: string;
    password: string;
}

const stored = schema.playlists;

/**
 * Records the panel clock a successful account-info check learned as ONE
 * conditional UPDATE: the row must still point at the panel the answer
 * came from (`DB_UPDATE_PLAYLIST` may have moved it meanwhile), a payload
 * already carrying the value is left untouched, and a malformed payload is
 * never rewritten. No read precedes the write, so it can neither hand a
 * concurrent upsert's newer payload back to the past nor undo an edit that
 * landed in between.
 */
export async function setPlaylistServerTimezone(
    db: AppDatabase,
    playlistId: string,
    connection: PlaylistConnectionIdentity,
    serverTimezone: string
): Promise<{ updated: boolean }> {
    const result = await db
        .update(stored)
        .set({
            payload: sql`CASE
                WHEN ${stored.payload} IS NULL
                THEN json_object('serverTimezone', ${serverTimezone})
                ELSE json_set(${stored.payload}, '$.serverTimezone', ${serverTimezone})
            END`,
        })
        .where(
            // CASE, not AND: SQLite may reorder AND terms, and json_extract
            // raises on a malformed payload unless json_valid ran first.
            sql`${stored.id} = ${playlistId}
                AND ${stored.serverUrl} IS ${connection.serverUrl}
                AND ${stored.username} IS ${connection.username}
                AND ${stored.password} IS ${connection.password}
                AND CASE
                    WHEN ${stored.payload} IS NULL THEN 1
                    WHEN json_valid(${stored.payload})
                    THEN json_extract(${stored.payload}, '$.serverTimezone') IS NOT ${serverTimezone}
                    ELSE 0
                END`
        )
        .run();

    return { updated: result.changes > 0 };
}

/**
 * The payload expression for a `DB_UPDATE_PLAYLIST` that sets `serverUrl`:
 * a learned clock belongs to the panel it was learned from, so pointing the
 * row at another server drops it until the next account-info check, and
 * Favorites / Recent catch-up cannot keep rendering the OLD panel's clock.
 */
export function serverTimezoneInvalidation(nextServerUrl: string): SQL {
    return sql`CASE
        WHEN ${stored.serverUrl} IS NOT ${nextServerUrl}
            AND json_valid(${stored.payload})
        THEN json_remove(${stored.payload}, '$.serverTimezone')
        ELSE ${stored.payload}
    END`;
}
