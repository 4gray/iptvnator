const { BrowserWindow, app } = require('electron');
const Database = require('better-sqlite3');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');

const mode = process.env.IPTVNATOR_E2E_MIGRATION_MODE;
const databasePath = process.env.IPTVNATOR_E2E_MIGRATION_DATABASE_PATH;
const resultPath = process.env.IPTVNATOR_E2E_MIGRATION_RESULT_PATH;

if (
    (mode !== 'create' && mode !== 'inspect') ||
    !databasePath ||
    !resultPath
) {
    throw new Error('SQLite recording migration fixture arguments are invalid');
}

const legacyRecordingsSql = `CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('xtream', 'stalker', 'm3u')),
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    stream_url TEXT NOT NULL,
    request_headers TEXT,
    recording_directory TEXT,
    poster_url TEXT,
    epg_program_id INTEGER,
    epg_channel_id TEXT,
    scheduled_start_at TEXT NOT NULL,
    scheduled_end_at TEXT NOT NULL,
    padding_before_seconds INTEGER NOT NULL DEFAULT 0,
    padding_after_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'scheduled',
    file_name TEXT,
    file_path TEXT,
    bytes_recorded INTEGER,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)`;

function createLegacyDatabase() {
    mkdirSync(dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    try {
        database.exec(legacyRecordingsSql);
        database
            .prepare(
                `INSERT INTO recordings (
                    id, playlist_id, source_type, channel_id, channel_name,
                    title, stream_url, request_headers, scheduled_start_at,
                    scheduled_end_at, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                'legacy-recording',
                'playlist-1',
                'm3u',
                'news',
                'News',
                'Legacy recording',
                'https://example.com/private-stream',
                JSON.stringify({ Authorization: 'Bearer secret' }),
                '2099-07-14T18:00:00.000Z',
                '2099-07-14T19:00:00.000Z',
                'scheduled'
            );
    } finally {
        database.close();
    }
    return { created: true };
}

function inspectMigratedDatabase() {
    const database = new Database(databasePath);
    try {
        const streamUrlColumn = database
            .prepare('PRAGMA table_info(recordings)')
            .all()
            .find((column) => column.name === 'stream_url');
        const recording = database
            .prepare('SELECT stream_url FROM recordings WHERE id = ?')
            .get('legacy-recording');
        const indexes = database
            .prepare(
                `SELECT name FROM sqlite_master
                 WHERE type = 'index' AND tbl_name = 'recordings'
                 ORDER BY name`
            )
            .all()
            .map((row) => row.name);
        const legacyTableCount = database
            .prepare(
                `SELECT COUNT(*) AS count FROM sqlite_master
                 WHERE type = 'table'
                   AND name = 'recordings_legacy_not_null_stream_url'`
            )
            .get().count;
        return {
            indexes,
            legacyTableCount,
            streamUrl: recording.stream_url,
            streamUrlNotNull: streamUrlColumn.notnull,
        };
    } finally {
        database.close();
    }
}

app.whenReady().then(async () => {
    let result;
    try {
        result =
            mode === 'create'
                ? createLegacyDatabase()
                : inspectMigratedDatabase();
        result = { ...result, success: true };
    } catch (error) {
        result = {
            error: error instanceof Error ? error.message : String(error),
            success: false,
        };
    }
    writeFileSync(resultPath, JSON.stringify(result), 'utf8');

    const window = new BrowserWindow({ show: false });
    await window.loadURL('data:text/html,<title>sqlite-fixture-ready</title>');
});
