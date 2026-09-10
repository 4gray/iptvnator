import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { closeDatabase, getDatabasePath, initDatabase } from '../connection';

const tables = [
    'playlists',
    'categories',
    'content',
    'favorites',
    'recently_viewed',
    'playback_positions',
    'downloads',
] as const;

function seed(sqlite: Database.Database) {
    sqlite.exec(`
        INSERT INTO playlists (id, name, type, serverUrl, username, password)
        VALUES ('saved', 'Saved source', 'xtream', 'https://source.invalid',
                'synthetic-user', 'synthetic-password');
        INSERT INTO categories (id, playlist_id, name, type, xtream_id, hidden)
        VALUES (1, 'saved', 'Movies', 'movies', 42, 1);
        INSERT INTO content (id, category_id, title, xtream_id, type, added)
        VALUES (1, 1, 'Saved movie', 7, 'movie', '1700000000');
        INSERT INTO favorites (content_id, playlist_id) VALUES (1, 'saved');
        INSERT INTO recently_viewed (content_id, playlist_id) VALUES (1, 'saved');
        INSERT INTO playback_positions
            (playlist_id, content_xtream_id, content_type, position_seconds, duration_seconds)
        VALUES ('saved', 7, 'vod', 123, 1800);
        INSERT INTO downloads (playlist_id, xtream_id, content_type, title, url, status)
        VALUES ('saved', 7, 'vod', 'Saved movie', 'https://source.invalid/movie', 'completed');
    `);
    const columns = sqlite.pragma('table_info(content)') as { name: string }[];
    if (columns.some(({ name }) => name === 'epg_channel_id')) {
        sqlite.exec("UPDATE content SET epg_channel_id = 'retained-epg-id'");
    }
}

function snapshot(sqlite: Database.Database) {
    return tables.map((table) => {
        const columns = sqlite.pragma(`table_info(${table})`) as {
            name: string;
        }[];
        const query = `SELECT ${columns.map(({ name }) => `"${name}"`).join(', ')} FROM ${table} ORDER BY id`;
        return { query, rows: sqlite.prepare(query).all() };
    });
}

function epgIndex(sqlite: Database.Database) {
    return sqlite
        .prepare(
            "SELECT sql, rootpage FROM sqlite_master WHERE name = 'idx_content_epg_channel'"
        )
        .get();
}

async function main() {
    const fixture = process.argv[2];
    assert(
        process.env['IPTVNATOR_E2E_DATA_DIR'],
        'Never open the user database'
    );
    const warnings: unknown[][] = [];
    console.warn = (...args) => warnings.push(args);
    console.log = () => undefined;
    const databasePath = getDatabasePath();

    if (fixture === 'fresh') {
        await initDatabase();
        closeDatabase();
    }
    const legacy = new Database(databasePath);
    legacy.pragma('foreign_keys = ON');
    if (fixture !== 'fresh') legacy.exec(readFileSync(fixture, 'utf8'));
    seed(legacy);
    const before = snapshot(legacy);
    const originalIndex = epgIndex(legacy);
    legacy.close();

    let firstSchema: unknown;
    for (let startup = 0; startup < 2; startup++) {
        try {
            await initDatabase();
            const sqlite = new Database(databasePath, { readonly: true });
            try {
                for (const { query, rows } of before) {
                    assert.deepEqual(sqlite.prepare(query).all(), rows, query);
                }
                assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
                assert.deepEqual(sqlite.pragma('integrity_check'), [
                    { integrity_check: 'ok' },
                ]);
                const index = epgIndex(sqlite);
                assert(index, 'EPG index must exist after initialization');
                assert.deepEqual(
                    (
                        sqlite.pragma(
                            'index_info(idx_content_epg_channel)'
                        ) as { name: string }[]
                    ).map(({ name }) => name),
                    ['epg_channel_id']
                );
                if (originalIndex) assert.deepEqual(index, originalIndex);
                // closeDatabase() may add SQLite's own planner statistics via
                // PRAGMA optimize; compare only application schema objects.
                const schema = sqlite
                    .prepare(
                        "SELECT type, name, sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name"
                    )
                    .all();
                if (startup === 0) firstSchema = schema;
                else assert.deepEqual(schema, firstSchema);
            } finally {
                sqlite.close();
            }
        } finally {
            closeDatabase();
        }
    }
    assert.deepEqual(
        warnings,
        [],
        'Initialization must not silently skip failed migrations'
    );
    process.stdout.write('upgrade verified');
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
