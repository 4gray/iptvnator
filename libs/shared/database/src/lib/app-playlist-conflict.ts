/**
 * The `DO UPDATE` half of an app-playlist upsert and the payload clock
 * reader, shared with the self-hosted web backend. The conditional writers
 * that complete this contract stay in the Electron backend's
 * `playlist-server-timezone.operations.ts` (issue #1562).
 */
import { sql, type SQL } from 'drizzle-orm';
import * as schema from './schema';

export type PlaylistConflictUpdate = {
    [K in keyof schema.NewPlaylist]?: schema.NewPlaylist[K] | SQL;
};

const stored = schema.playlists;

/**
 * Columns a whole-document upsert must rewrite even when the document no
 * longer has a value: the codec maps empty values to `undefined`, which an
 * `ON CONFLICT DO UPDATE` skips, so a cleared field would keep its old
 * column value and `parseAppPlaylist` would bring it back. `dateCreated`
 * belongs to the first insert, and `name`, `type`, `autoRefresh`,
 * `payload` and `lastUsage` always carry a value.
 */
const REPLACEABLE_COLUMNS = [
    'serverUrl',
    'username',
    'password',
    'lastUpdated',
    'userAgent',
    'origin',
    'referrer',
    'filePath',
    'epgUrls',
    'detectedEpgUrls',
    'manualEpgUrls',
    'disabledEpgUrls',
    'macAddress',
    'url',
    'portalUrl',
    'count',
    'importDate',
    'updateDate',
    'position',
    'favorites',
    'recentlyViewed',
] as const satisfies readonly (keyof schema.NewPlaylist)[];

function withClearedColumns(row: schema.NewPlaylist): schema.NewPlaylist {
    const cleared: Partial<Record<(typeof REPLACEABLE_COLUMNS)[number], null>> =
        {};
    for (const column of REPLACEABLE_COLUMNS) {
        if (row[column] === undefined) {
            cleared[column] = null;
        }
    }
    return { ...row, ...cleared };
}

/**
 * The `DO UPDATE` half of an app-playlist upsert. The document replaces
 * the stored one, so every optional column it leaves empty is set to NULL
 * rather than skipped (see REPLACEABLE_COLUMNS).
 *
 * A full upsert is built from a snapshot the caller read earlier; when
 * that snapshot carries no panel clock while the stored row does —
 * `setPlaylistServerTimezone` landed in between — the stored clock is
 * carried over as long as the row still points at the same panel, so a
 * favorites, recent-items or metadata write cannot hand a clockless
 * payload back to the past. A snapshot that carries its own clock, or
 * moves the source, wins as is. Nested CASE, not AND: SQLite may reorder
 * AND terms, and the json_* readers raise on a malformed payload unless
 * json_valid ran first.
 */
export function playlistConflictUpdate(
    row: schema.NewPlaylist,
    playlist: Record<string, unknown>
): PlaylistConflictUpdate {
    const replacement = withClearedColumns(row);
    if (readString(playlist['serverTimezone'])) {
        return replacement;
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
    return { ...replacement, payload };
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
            ? readString((parsed as Record<string, unknown>)['serverTimezone'])
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
