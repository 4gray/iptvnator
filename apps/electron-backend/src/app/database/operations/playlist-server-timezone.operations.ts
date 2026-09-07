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

export interface PlaylistConnectionIdentity {
    serverUrl: string;
    username: string;
    password: string;
}

export type PlaylistConflictUpdate = {
    [K in keyof schema.NewPlaylist]?: schema.NewPlaylist[K] | SQL;
};

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

/**
 * The `DO UPDATE` half of an app-playlist upsert. A full upsert is built
 * from a snapshot the caller read earlier; when that snapshot carries no
 * panel clock while the stored row does — `setPlaylistServerTimezone`
 * landed in between — the stored clock is carried over as long as the row
 * still points at the same panel, so a favorites, recent-items or metadata
 * write cannot hand a clockless payload back to the past. A snapshot that
 * carries its own clock, or moves the source, wins as is. Nested CASE, not
 * AND: SQLite may reorder AND terms, and the json_* readers raise on a
 * malformed payload unless json_valid ran first.
 */
export function playlistConflictUpdate(
    row: schema.NewPlaylist,
    playlist: Record<string, unknown>
): PlaylistConflictUpdate {
    if (readString(playlist.serverTimezone)) {
        return row;
    }
    const excludedPayload = sql.raw(`excluded.${stored.payload.name}`);
    const payload = sql`CASE
        WHEN json_valid(${stored.payload})
        THEN CASE
            WHEN json_type(${stored.payload}, '$.serverTimezone') = 'text'
                AND ${stored.serverUrl} IS excluded.${sql.raw(stored.serverUrl.name)}
                AND ${stored.username} IS excluded.${sql.raw(stored.username.name)}
                AND ${stored.password} IS excluded.${sql.raw(stored.password.name)}
            THEN json_set(
                ${excludedPayload},
                '$.serverTimezone',
                json_extract(${stored.payload}, '$.serverTimezone')
            )
            ELSE ${excludedPayload}
        END
        ELSE ${excludedPayload}
    END`;
    return { ...row, payload };
}

/**
 * The clock stored in a raw row's payload, for `DB_GET_PLAYLIST`: the
 * Xtream store seeds `currentPlaylist` from that read before (or without)
 * the account-info check that learns the value.
 */
export function readPayloadServerTimezone(
    payload: string | null | undefined
): string | undefined {
    if (!payload) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(payload);
        return parsed && typeof parsed === 'object'
            ? readString((parsed as Record<string, unknown>).serverTimezone)
            : undefined;
    } catch {
        return undefined;
    }
}

function readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}
