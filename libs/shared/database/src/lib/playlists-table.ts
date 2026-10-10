import type Database from 'better-sqlite3';

/**
 * The playlists table's columns in creation order. `payload` (an M3U
 * playlist's channels, up to several MB per row) must stay LAST: SQLite
 * reads a row's columns in order and walks the overflow pages of every
 * column before the one it needs, so any column after `payload` costs the
 * whole payload on each read (playlist metadata took 4-22 s on a profile
 * with 70 MB of payloads). Columns appended by `ALTER TABLE ADD COLUMN`
 * land after it; `ensurePlaylistsPayloadLast` rebuilds such tables once.
 */
const PLAYLISTS_COLUMNS: readonly (readonly [
    name: string,
    definition: string,
])[] = [
    ['id', 'TEXT PRIMARY KEY'],
    ['name', 'TEXT NOT NULL'],
    ['serverUrl', 'TEXT'],
    ['username', 'TEXT'],
    ['password', 'TEXT'],
    ['date_created', `TEXT DEFAULT (datetime('now'))`],
    ['last_updated', 'TEXT'],
    [
        'type',
        `TEXT NOT NULL CHECK (type IN ('xtream', 'stalker', 'm3u-file', 'm3u-text', 'm3u-url'))`,
    ],
    ['userAgent', 'TEXT'],
    ['origin', 'TEXT'],
    ['referrer', 'TEXT'],
    ['filePath', 'TEXT'],
    ['epg_urls', 'TEXT'],
    ['detected_epg_urls', 'TEXT'],
    ['manual_epg_urls', 'TEXT'],
    ['disabled_epg_urls', 'TEXT'],
    ['autoRefresh', 'INTEGER DEFAULT 0'],
    ['macAddress', 'TEXT'],
    ['url', 'TEXT'],
    ['portal_url', 'TEXT'],
    ['count', 'INTEGER'],
    ['import_date', 'TEXT'],
    ['update_date', 'INTEGER'],
    ['position', 'INTEGER'],
    ['favorites', 'TEXT'],
    ['recently_viewed', 'TEXT'],
    ['last_usage', 'TEXT'],
    ['payload', 'TEXT'],
];

export function playlistsTableSql(tableName: string): string {
    const columns = PLAYLISTS_COLUMNS.map(
        ([name, definition]) => `      ${name} ${definition}`
    ).join(',\n');
    return `CREATE TABLE IF NOT EXISTS ${tableName} (\n${columns}\n  )`;
}

export const PLAYLISTS_REBUILD_TABLE = 'playlists_payload_rebuild';

/**
 * Foreign key violations in the tables that reference playlists. Only those:
 * a whole-database check would also walk the catalog and the EPG programmes.
 */
function countChildViolations(sqliteDb: Database.Database): number {
    const children = sqliteDb
        .prepare(
            `SELECT DISTINCT m.name AS name
             FROM sqlite_master AS m, pragma_foreign_key_list(m.name) AS f
             WHERE m.type = 'table' AND f."table" = 'playlists'`
        )
        .all() as { name: string }[];
    const checkChild = sqliteDb.prepare(
        `SELECT COUNT(*) AS count FROM pragma_foreign_key_check(?)`
    );
    return children.reduce(
        (total, { name }) =>
            total +
            ((checkChild.get(name) as { count?: number } | undefined)?.count ??
                0),
        0
    );
}

/**
 * Rebuilds `playlists` so that `payload` is its last column (see
 * PLAYLISTS_COLUMNS). Tables created before 0.19 got `payload` appended by
 * ALTER TABLE and the EPG URL columns after it; fresh installs up to 0.24
 * created `last_usage` after it. Runs after the column migrations, so the
 * legacy table holds every canonical column, and only when a column follows
 * `payload`: a rebuilt table is a no-op on the next start. Foreign keys are
 * switched off for the rebuild (categories, favorites, history, positions
 * and pins reference playlists ON DELETE CASCADE: the drop must not cascade,
 * and the rename of the new table leaves their REFERENCES clauses alone),
 * and the transaction commits only if the tables referencing playlists hold
 * no more foreign key violations than before.
 */
export function ensurePlaylistsPayloadLast(sqliteDb: Database.Database): void {
    const names = (
        sqliteDb
            .prepare(`SELECT name FROM pragma_table_info('playlists')`)
            .all() as { name: string }[]
    ).map(({ name }) => name);
    if (names.length === 0 || names[names.length - 1] === 'payload') {
        return;
    }
    const canonical = PLAYLISTS_COLUMNS.map(([name]) => name);
    const missing = canonical.filter((name) => !names.includes(name));
    if (missing.length > 0) {
        console.warn(
            `[DB] playlists rebuild skipped, columns missing: ${missing.join(', ')}`
        );
        return;
    }
    const columnList = canonical.map((name) => `"${name}"`).join(', ');
    const before = countChildViolations(sqliteDb);
    sqliteDb.pragma('foreign_keys = OFF');
    try {
        const rebuild = sqliteDb.transaction(() => {
            sqliteDb
                .prepare(`DROP TABLE IF EXISTS ${PLAYLISTS_REBUILD_TABLE}`)
                .run();
            sqliteDb.prepare(playlistsTableSql(PLAYLISTS_REBUILD_TABLE)).run();
            sqliteDb
                .prepare(
                    `INSERT INTO ${PLAYLISTS_REBUILD_TABLE} (${columnList})
                     SELECT ${columnList} FROM playlists`
                )
                .run();
            sqliteDb.prepare(`DROP TABLE playlists`).run();
            sqliteDb
                .prepare(
                    `ALTER TABLE ${PLAYLISTS_REBUILD_TABLE} RENAME TO playlists`
                )
                .run();
            // The rebuild must not orphan a row. Rows a legacy profile already
            // orphaned (written with foreign keys off) are not its doing and
            // must not block it on every start.
            const after = countChildViolations(sqliteDb);
            if (after > before) {
                throw new Error(
                    `${after - before} foreign key violation(s) after the rebuild`
                );
            }
        });
        rebuild();
        console.log(
            '[DB] Rebuilt playlists table with payload as its last column'
        );
    } catch (error) {
        console.warn('[DB] playlists payload-last rebuild failed:', error);
    } finally {
        sqliteDb.pragma('foreign_keys = ON');
    }
}
