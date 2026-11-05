import type Database from 'better-sqlite3';

export function favoritesTableSql(name = 'favorites'): string {
    return `CREATE TABLE IF NOT EXISTS ${name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER,
      playlist_id TEXT NOT NULL,
      xtream_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('live', 'movie', 'series')),
      title TEXT NOT NULL,
      poster_url TEXT,
      backdrop_url TEXT,
      tmdb_id INTEGER,
      release_year INTEGER,
      original_title TEXT,
      identity_conflict INTEGER NOT NULL DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      position INTEGER DEFAULT 0,
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE SET NULL,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  )`;
}

/** Runs after column upgrades, before cache deduplication and dependent indexes. */
export function ensureDurableFavorites(sqlite: Database.Database): void {
    const columns = sqlite.prepare("PRAGMA table_info('favorites')").all() as {
        name: string;
    }[];
    if (columns.some((column) => column.name === 'xtream_id')) return;
    // Historical profiles may already contain favorites with a missing owner.
    // Retain those exact records, but never let this rebuild introduce new ones.
    const orphanIds = new Set(
        (
            sqlite
                .prepare(
                    `SELECT f.id FROM favorites f
            LEFT JOIN playlists p ON p.id = f.playlist_id
            WHERE p.id IS NULL`
                )
                .all() as { id: number }[]
        ).map(({ id }) => id)
    );
    const foreignKeys = sqlite.pragma('foreign_keys', { simple: true });
    // This must happen outside the transaction; SQLite ignores it inside one.
    sqlite.pragma('foreign_keys = OFF');
    try {
        sqlite.transaction(() => {
            sqlite.exec(favoritesTableSql('favorites_durable'));
            // Multiple categories may contain the same provider item. Keep the first
            // saved favorite's primary key, timestamp and position deterministically.
            sqlite.exec(`INSERT INTO favorites_durable
            (id, content_id, playlist_id, xtream_id, type, title, poster_url,
             backdrop_url, tmdb_id, release_year, original_title, added_at, position)
            SELECT id, content_id, playlist_id, xtream_id, type, title, poster_url,
                   backdrop_url, tmdb_id, release_year, original_title, added_at, position
            FROM (
                SELECT f.id, c.id AS content_id, f.playlist_id,
                    COALESCE(c.xtream_id, -f.id) AS xtream_id,
                    COALESCE(c.type, 'movie') AS type,
                    COALESCE(c.title, 'Saved favorite') AS title,
                    c.poster_url, c.backdrop_url, c.tmdb_id, c.release_year, c.original_title,
                    f.added_at, f.position,
                    ROW_NUMBER() OVER (PARTITION BY f.playlist_id, c.type,
                        COALESCE(c.xtream_id, -f.id) ORDER BY f.id) AS identity_rank
                FROM favorites f LEFT JOIN content c ON c.id = f.content_id
            ) WHERE identity_rank = 1`);
            sqlite.exec('DROP TABLE favorites');
            sqlite.exec('ALTER TABLE favorites_durable RENAME TO favorites');
            sqlite.exec(
                'CREATE UNIQUE INDEX favorites_content_playlist_unique ON favorites(content_id, playlist_id)'
            );
            sqlite.exec(
                'CREATE INDEX favorites_playlist_idx ON favorites(playlist_id)'
            );
            sqlite.exec(
                'CREATE INDEX favorites_content_idx ON favorites(content_id)'
            );
            const violations = sqlite.pragma(
                'foreign_key_check(favorites)'
            ) as {
                rowid: number;
                parent: string;
            }[];
            if (
                violations.some(
                    ({ rowid, parent }) =>
                        parent !== 'playlists' || !orphanIds.has(rowid)
                )
            ) {
                throw new Error(
                    'Favorites migration introduced a foreign key violation'
                );
            }
        })();
    } finally {
        sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
}

/** Receipts are playlist-owned even though app_state is a generic key/value table. */
export const FAVORITES_RECEIPT_CLEANUP_TRIGGER = `CREATE TRIGGER IF NOT EXISTS favorites_receipts_playlist_delete
    AFTER DELETE ON playlists BEGIN
        DELETE FROM app_state WHERE substr(key, 1, length('xtream-favorites-restore:' || length(OLD.id) || ':' || OLD.id || ':')) =
            'xtream-favorites-restore:' || length(OLD.id) || ':' || OLD.id || ':'
            OR key IN ('xtream-import-status:' || OLD.id || ':live',
                'xtream-import-status:' || OLD.id || ':movie', 'xtream-import-status:' || OLD.id || ':series');
    END`;
