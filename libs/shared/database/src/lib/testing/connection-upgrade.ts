import { verifyFavoriteMigrationRollback } from './favorites-migration-rollback';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { closeDatabase, getDatabasePath, initDatabase } from '../connection';
import { setDatabaseConnectionObserver } from '../connection-observer';
import * as currentSchema from '../schema';

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
        INSERT INTO recently_viewed (content_id, playlist_id) VALUES (1, 'saved');
        INSERT INTO playback_positions
            (playlist_id, content_xtream_id, content_type, position_seconds, duration_seconds)
        VALUES ('saved', 7, 'vod', 123, 1800);
        INSERT INTO downloads (playlist_id, xtream_id, content_type, title, url, status)
        VALUES ('saved', 7, 'vod', 'Saved movie', 'https://source.invalid/movie', 'completed');
    `);
    const favoriteColumns = sqlite.pragma('table_info(favorites)') as {
        name: string;
    }[];
    const durable = favoriteColumns.some(({ name }) => name === 'xtream_id');
    sqlite.exec(
        durable
            ? `INSERT INTO favorites (id, content_id, playlist_id, added_at, position, xtream_id, type, title) VALUES (42, 1, 'saved', '2025-01-01', 9, 7, 'movie', 'Saved movie')`
            : `INSERT INTO favorites (id, content_id, playlist_id, added_at) VALUES (42, 1, 'saved', '2025-01-01')`
    );
    if (favoriteColumns.some(({ name }) => name === 'position')) {
        sqlite.exec('UPDATE favorites SET position = 9');
    }
    const columns = sqlite.pragma('table_info(content)') as { name: string }[];
    if (columns.some(({ name }) => name === 'epg_channel_id')) {
        sqlite.exec("UPDATE content SET epg_channel_id = 'retained-epg-id'");
    }
    // An M3U source with a channel payload and every playlist column the
    // schema has: the payload-last rebuild of `playlists` must carry them all
    // across unchanged.
    const playlistColumns = new Set(
        (sqlite.pragma('table_info(playlists)') as { name: string }[]).map(
            ({ name }) => name
        )
    );
    if (playlistColumns.has('payload')) {
        const values: Record<string, string | number> = {
            id: 'm3u',
            name: 'Saved list',
            type: 'm3u-url',
            url: 'https://list.invalid/a.m3u',
            payload: '{"channels":[{"name":"One"}]}',
            epg_urls: '["https://epg.invalid/a.xml"]',
            detected_epg_urls: '["https://epg.invalid/b.xml"]',
            favorites: '["one"]',
            recently_viewed: '["one"]',
            last_usage: '2026-01-01T00:00:00.000Z',
            count: 1,
        };
        const present = Object.keys(values).filter((name) =>
            playlistColumns.has(name)
        );
        sqlite
            .prepare(
                `INSERT INTO playlists (${present.join(', ')})
                 VALUES (${present.map(() => '?').join(', ')})`
            )
            .run(...present.map((name) => values[name]));
    }
}

const titleIndexRebuilds: string[] = [];

/**
 * Every full rebuild of the title FTS index goes through `prepare`. A profile
 * needs one; another on a later launch re-indexes the whole catalog on the
 * main thread before the app can read anything.
 */
function countTitleIndexRebuilds(connection: Database.Database): void {
    const prepare = connection.prepare;
    connection.prepare = function countingPrepare(
        this: Database.Database,
        sql: string
    ) {
        if (
            /content_title_fts\(content_title_fts\)\s+VALUES\s+\('rebuild'\)/.test(
                sql
            )
        ) {
            titleIndexRebuilds.push(sql);
        }
        return prepare.call(this, sql);
    } as typeof connection.prepare;
}

/**
 * The performance capture counts one `exec` call as one SQL statement
 * (apps/electron-backend/src/app/workers/database-worker-sql-statement-count.ts),
 * so initialization must pass exactly one statement per `exec`. better-sqlite3
 * refuses to prepare a string with a second statement; other prepare errors
 * are left to `exec` itself (for example an idempotent ALTER TABLE).
 */
function requireSingleStatementExec(): string[] {
    const batches: string[] = [];
    setDatabaseConnectionObserver((connection) => {
        countTitleIndexRebuilds(connection);
        const exec = connection.exec;
        connection.exec = function singleStatementExec(sql: string) {
            try {
                connection.prepare(sql);
            } catch (error) {
                if (error instanceof RangeError) {
                    batches.push(sql.replace(/\s+/g, ' ').slice(0, 120));
                }
            }
            return exec.call(this, sql);
        };
    });
    return batches;
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

function foreignKeyViolations(sqlite: Database.Database) {
    // Rebuilding a table can reorder its FK definitions without changing the
    // affected row or parent, so compare identities rather than FK ordinals.
    return (
        sqlite.pragma('foreign_key_check') as {
            table: string;
            rowid: number;
            parent: string;
        }[]
    ).map(({ table, rowid, parent }) => ({ table, rowid, parent }));
}

function verifyCurrentSchema(sqlite: Database.Database) {
    for (const table of Object.values(currentSchema)) {
        const { name, columns, indexes } = getTableConfig(table);
        const actualColumns = sqlite.pragma(`table_info(${name})`) as {
            name: string;
            type: string;
        }[];
        assert(actualColumns.length > 0, `Missing current table: ${name}`);
        for (const column of columns) {
            const actual = actualColumns.find(
                (item) => item.name === column.name
            );
            assert(actual, `Missing current column: ${name}.${column.name}`);
            assert.equal(
                actual.type.toLowerCase(),
                column.getSQLType().toLowerCase()
            );
        }
        const actualIndexes = sqlite.pragma(`index_list(${name})`) as {
            name: string;
            unique: number;
        }[];
        for (const { config } of indexes) {
            const actual = actualIndexes.find(
                (item) => item.name === config.name
            );
            assert(actual, `Missing current index: ${config.name}`);
            assert.equal(actual.unique, Number(config.unique), config.name);
        }
    }
}

async function main() {
    const fixture = process.argv[2];
    if (fixture === 'rollback') {
        verifyFavoriteMigrationRollback();
        process.stdout.write('upgrade verified');
        return;
    }
    assert(
        process.env['IPTVNATOR_E2E_DATA_DIR'],
        'Never open the user database'
    );
    const warnings: unknown[][] = [];
    console.warn = (...args) => warnings.push(args);
    console.log = () => undefined;
    const databasePath = getDatabasePath();
    const execBatches = requireSingleStatementExec();

    if (fixture === 'fresh') {
        await initDatabase();
        closeDatabase();
    }
    const legacy = new Database(databasePath);
    legacy.pragma('foreign_keys = ON');
    if (fixture !== 'fresh') legacy.exec(readFileSync(fixture, 'utf8'));
    seed(legacy);
    if (process.argv[3] === 'orphans') {
        legacy.pragma('foreign_keys = OFF');
        legacy.exec(`INSERT INTO favorites (id, content_id, playlist_id, added_at)
            VALUES (43, 1, 'deleted-playlist', '2024-01-01')`);
        legacy.pragma('foreign_keys = ON');
    }
    const before = snapshot(legacy);
    const originalViolations = foreignKeyViolations(legacy);
    if (process.argv[3] === 'deduplicate') {
        legacy.exec(`INSERT INTO categories (id, playlist_id, name, type, xtream_id, hidden)
            VALUES (2, 'saved', 'Movies', 'movies', 42, 1);
            INSERT INTO content (id, category_id, title, xtream_id, type, added)
            VALUES (2, 2, 'Original favorite title', 7, 'movie', '1700000000');
            UPDATE favorites SET content_id = 2;`);
    }
    const originalIndex = epgIndex(legacy);
    legacy.close();

    let firstSchema: unknown;
    for (let startup = 0; startup < 2; startup++) {
        try {
            await initDatabase();
            const sqlite = new Database(databasePath, { readonly: true });
            try {
                verifyCurrentSchema(sqlite);
                assert.equal(
                    (
                        sqlite.pragma('table_info(playlists)') as {
                            name: string;
                        }[]
                    ).at(-1)?.name,
                    'payload',
                    'payload must be the last playlists column'
                );
                for (const { query, rows } of before) {
                    assert.deepEqual(sqlite.prepare(query).all(), rows, query);
                }
                assert.deepEqual(
                    sqlite
                        .prepare(
                            'SELECT id, content_id, playlist_id, xtream_id, type, title, added_at FROM favorites'
                        )
                        .get(),
                    {
                        id: 42,
                        content_id: 1,
                        playlist_id: 'saved',
                        xtream_id: 7,
                        type: 'movie',
                        title:
                            process.argv[3] === 'deduplicate'
                                ? 'Original favorite title'
                                : 'Saved movie',
                        added_at: '2025-01-01',
                    }
                );
                const favoriteForeignKeys = sqlite.pragma(
                    'foreign_key_list(favorites)'
                ) as { from: string; on_delete: string }[];
                assert.equal(
                    favoriteForeignKeys.find((key) => key.from === 'content_id')
                        ?.on_delete,
                    'SET NULL'
                );
                assert.deepEqual(
                    foreignKeyViolations(sqlite),
                    originalViolations
                );
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
    assert.deepEqual(
        execBatches,
        [],
        'Initialization must pass one SQL statement per exec call'
    );
    assert.equal(
        titleIndexRebuilds.length,
        1,
        'The title index must be rebuilt once per profile, not on every launch'
    );
    process.stdout.write('upgrade verified');
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
