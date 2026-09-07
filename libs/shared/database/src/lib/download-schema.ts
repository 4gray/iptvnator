import type Database from 'better-sqlite3';

export const DOWNLOADS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      xtream_id INTEGER NOT NULL,
      content_type TEXT NOT NULL CHECK (content_type IN ('vod', 'episode', 'catchup')),
      programme_start INTEGER NOT NULL DEFAULT 0,
      catchup TEXT,
      series_xtream_id INTEGER,
      season_number INTEGER,
      episode_number INTEGER,
      episode_identity_scope TEXT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      file_name TEXT,
      file_path TEXT,
      poster_url TEXT,
      request_headers TEXT,
      resume_validator TEXT,
      metadata_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'downloading', 'paused', 'completed', 'failed', 'canceled')),
      bytes_downloaded INTEGER DEFAULT 0,
      total_bytes INTEGER,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
  )`;
export const DOWNLOADS_INDEX_STATEMENTS = [
    `CREATE UNIQUE INDEX IF NOT EXISTS downloads_xtream_playlist_unique ON downloads(xtream_id, playlist_id, content_type) WHERE content_type != 'catchup'`,
    `CREATE INDEX IF NOT EXISTS downloads_playlist_idx ON downloads(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS downloads_status_idx ON downloads(status)`,
];

const ARCHIVE_FINALIZATIONS_SQL = `CREATE TABLE IF NOT EXISTS download_archive_finalizations (
    download_id INTEGER PRIMARY KEY REFERENCES downloads(id) ON DELETE CASCADE,
    proof TEXT NOT NULL
)`;

const CATCHUP_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS downloads_catchup_unique
    ON downloads(xtream_id, playlist_id, programme_start) WHERE content_type = 'catchup'`;

/** Widen the CHECK transactionally; existing ids, files and resume state survive. */
export function ensureDownloadsCatchupSchema(db: Database.Database): void {
    const row = db
        .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'downloads'"
        )
        .get() as { sql: string } | undefined;
    if (!row) return;
    if (row.sql.includes("'catchup'")) {
        db.exec(CATCHUP_INDEX);
        db.exec(ARCHIVE_FINALIZATIONS_SQL);
        return;
    }
    const columns = [
        'id',
        'playlist_id',
        'xtream_id',
        'content_type',
        'series_xtream_id',
        'season_number',
        'episode_number',
        'episode_identity_scope',
        'title',
        'url',
        'file_name',
        'file_path',
        'poster_url',
        'request_headers',
        'resume_validator',
        'metadata_snapshot',
        'status',
        'bytes_downloaded',
        'total_bytes',
        'error_message',
        'created_at',
        'updated_at',
    ];
    db.transaction(() => {
        db.exec('DROP INDEX IF EXISTS downloads_xtream_playlist_unique');
        db.exec('DROP INDEX IF EXISTS downloads_playlist_idx');
        db.exec('DROP INDEX IF EXISTS downloads_status_idx');
        db.exec('ALTER TABLE downloads RENAME TO downloads_catchup_legacy');
        db.exec(DOWNLOADS_TABLE_SQL);
        db.exec(
            `INSERT INTO downloads (${columns.join(',')}) SELECT ${columns.join(',')} FROM downloads_catchup_legacy`
        );
        db.exec('DROP TABLE downloads_catchup_legacy');
        for (const statement of DOWNLOADS_INDEX_STATEMENTS) db.exec(statement);
        db.exec(CATCHUP_INDEX);
        db.exec(ARCHIVE_FINALIZATIONS_SQL);
    })();
}
