import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Server-only table: one JSON value per Xtream user-data namespace and
 * playlist. Created by `openServerDatabase`, never by the desktop app.
 */
export const SERVER_USER_STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS server_user_state (
    namespace TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (namespace, playlist_id)
)`;

export const serverUserState = sqliteTable(
    'server_user_state',
    {
        namespace: text('namespace').notNull(),
        playlistId: text('playlist_id').notNull(),
        value: text('value').notNull(),
        updatedAt: text('updated_at').notNull(),
    },
    (table) => [primaryKey({ columns: [table.namespace, table.playlistId] })]
);
