import { SERVER_PAYLOAD_FIELDS } from '@iptvnator/shared/interfaces';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Server-only table: each playlist document without its M3U payload
 * fields, written with every upsert. Metadata reads take the JSON-only
 * fields (filename, hidden groups, Stalker identity) from here, so they
 * never walk the payload blobs. Created by `openServerDatabase`, never by
 * the desktop app.
 */
export const SERVER_PLAYLIST_META_TABLE_SQL = `CREATE TABLE IF NOT EXISTS server_playlist_meta (
    playlist_id TEXT PRIMARY KEY NOT NULL,
    document TEXT
)`;

const PAYLOAD_PATHS = SERVER_PAYLOAD_FIELDS.map((field) => `'$.${field}'`).join(
    ', '
);

/**
 * Fills the table for playlists written without it, for example a
 * database copied from the desktop app. Reads each such payload once;
 * later starts find nothing to do.
 */
export const SERVER_PLAYLIST_META_BACKFILL_SQL = `INSERT INTO server_playlist_meta (playlist_id, document)
SELECT id, CASE
    WHEN json_valid(payload) THEN json_remove(payload, ${PAYLOAD_PATHS})
    ELSE NULL
END
FROM playlists
WHERE id NOT IN (SELECT playlist_id FROM server_playlist_meta)`;

/** A stored payload without its M3U fields, or NULL when it is not JSON. */
export function payloadMetadata(payload: SQLWrapper): SQL<string | null> {
    return sql<string | null>`CASE
        WHEN json_valid(${payload})
        THEN json_remove(${payload}, ${sql.raw(PAYLOAD_PATHS)})
        ELSE NULL
    END`;
}

export const serverPlaylistMeta = sqliteTable('server_playlist_meta', {
    playlistId: text('playlist_id').primaryKey().notNull(),
    document: text('document'),
});

/** The document as metadata reads see it: no payload fields. */
export function metadataDocument(
    document: Readonly<Record<string, unknown>>
): string {
    const metadata: Record<string, unknown> = { ...document };
    for (const field of SERVER_PAYLOAD_FIELDS) {
        delete metadata[field];
    }
    return JSON.stringify(metadata);
}
