import type Database from 'better-sqlite3';

export const RECORDINGS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('xtream', 'stalker', 'm3u')),
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      stream_url TEXT,
      request_headers TEXT,
      recording_directory TEXT,
      poster_url TEXT,
      epg_program_id INTEGER,
      epg_channel_id TEXT,
      scheduled_start_at TEXT NOT NULL,
      scheduled_end_at TEXT NOT NULL,
      padding_before_seconds INTEGER NOT NULL DEFAULT 0,
      padding_after_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'recording', 'completed', 'failed', 'canceled', 'missed', 'interrupted')),
      file_name TEXT,
      file_path TEXT,
      bytes_recorded INTEGER,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
  )`;

export const RECORDINGS_INDEX_SQL = [
    `CREATE INDEX IF NOT EXISTS recordings_playlist_idx ON recordings(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS recordings_status_start_idx ON recordings(status, scheduled_start_at)`,
    `CREATE INDEX IF NOT EXISTS recordings_completed_idx ON recordings(completed_at)`,
] as const;

const RECORDING_COLUMN_NAMES = [
    'id',
    'playlist_id',
    'source_type',
    'channel_id',
    'channel_name',
    'title',
    'description',
    'stream_url',
    'request_headers',
    'recording_directory',
    'poster_url',
    'epg_program_id',
    'epg_channel_id',
    'scheduled_start_at',
    'scheduled_end_at',
    'padding_before_seconds',
    'padding_after_seconds',
    'status',
    'file_name',
    'file_path',
    'bytes_recorded',
    'error_message',
    'started_at',
    'completed_at',
    'created_at',
    'updated_at',
].join(', ');

/** Rebuild the pre-release DVR table whose stream URL could not be cleared. */
export function relaxRecordingPlaybackSnapshotNullability(
    sqliteDb: Database.Database
): void {
    type TableColumn = { name: string; notnull: number };
    const columns = sqliteDb
        .prepare(`PRAGMA table_info(recordings)`)
        .all() as TableColumn[];
    const streamUrl = columns.find((column) => column.name === 'stream_url');
    if (!streamUrl || streamUrl.notnull === 0) {
        return;
    }

    const rebuild = sqliteDb.transaction(() => {
        sqliteDb.exec(
            `ALTER TABLE recordings RENAME TO recordings_legacy_not_null_stream_url`
        );
        dropRecordingIndexes(sqliteDb);
        sqliteDb.exec(RECORDINGS_TABLE_SQL);
        sqliteDb.exec(
            `INSERT INTO recordings (${RECORDING_COLUMN_NAMES})
             SELECT ${RECORDING_COLUMN_NAMES}
             FROM recordings_legacy_not_null_stream_url`
        );
        sqliteDb.exec(`DROP TABLE recordings_legacy_not_null_stream_url`);
        for (const indexSql of RECORDINGS_INDEX_SQL) {
            sqliteDb.exec(indexSql);
        }
    });

    rebuild();
}

function dropRecordingIndexes(sqliteDb: Database.Database): void {
    for (const indexSql of RECORDINGS_INDEX_SQL) {
        const indexName = indexSql.match(/INDEX IF NOT EXISTS ([^ ]+)/)?.[1];
        if (indexName) {
            sqliteDb.exec(`DROP INDEX IF EXISTS ${indexName}`);
        }
    }
}
