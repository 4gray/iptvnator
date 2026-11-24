/**
 * A populated 0.21/0.22 profile through the real `initDatabase()`: startup
 * must not re-index the catalog, the build the worker runs afterwards must
 * produce the folded index, and repeated startups must be stable. Run under
 * Electron as Node by connection-upgrades.spec.ts, through run-electron-harness.ts:
 *
 *   electron --import tsx content-title-fts-upgrade.ts <schema.sql> <indexed|unindexed>
 *
 * Prints `upgrade verified`. Synthetic titles only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { closeDatabase, getDatabasePath, initDatabase } from '../connection';
import { setDatabaseConnectionObserver } from '../connection-observer';
import {
    buildContentTitleFtsBatch,
    CONTENT_TITLE_FTS_BUILD_CURSOR_KEY,
    CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY,
    CONTENT_TITLE_FTS_MIGRATION_KEY,
    CONTENT_TITLE_FTS_STARTUP_REBUILD_LIMIT,
    isContentTitleFtsBuildPending,
} from '../content-title-fts';

const ROWS = CONTENT_TITLE_FTS_STARTUP_REBUILD_LIMIT + 10_000;

function seed(sqlite: Database.Database, indexed: boolean) {
    sqlite.exec(`INSERT INTO playlists (id, name, type, serverUrl, username, password)
        VALUES ('saved', 'Saved source', 'xtream', 'https://source.invalid',
                'synthetic-user', 'synthetic-password')`);
    sqlite.exec(`INSERT INTO categories (id, playlist_id, name, type, xtream_id)
        VALUES (1, 'saved', 'Movies', 'movies', 1)`);
    sqlite.exec(`INSERT INTO content (id, category_id, title, xtream_id, type)
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${ROWS})
        SELECT i, 1, CASE WHEN i % 4 = 0 THEN 'Amélie ' || i ELSE 'Synthetic ' || i END,
               i, 'movie' FROM n`);
    if (indexed) {
        // What 0.22 left: the plain trigram index, built and recorded.
        sqlite.exec(
            `INSERT INTO content_title_fts(content_title_fts) VALUES ('rebuild')`
        );
        sqlite
            .prepare(`INSERT INTO app_state (key, value) VALUES (?, 'done')`)
            .run(CONTENT_TITLE_FTS_MIGRATION_KEY);
    }
}

const rebuilds: string[] = [];

function countRebuilds() {
    setDatabaseConnectionObserver((connection) => {
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
                rebuilds.push(sql);
            }
            return prepare.call(this, sql);
        } as typeof connection.prepare;
    });
}

function count(sqlite: Database.Database, sql: string): number {
    return (sqlite.prepare(sql).get() as { n: number }).n;
}

function matches(sqlite: Database.Database, query: string): number {
    return (
        sqlite
            .prepare(
                `SELECT COUNT(*) AS n FROM content_title_fts
                 WHERE content_title_fts MATCH ?`
            )
            .get(query) as { n: number }
    ).n;
}

function state(sqlite: Database.Database, key: string): string | undefined {
    return (
        sqlite.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key) as
            { value: string } | undefined
    )?.value;
}

async function startup(): Promise<Database.Database> {
    await initDatabase();
    closeDatabase();
    return new Database(getDatabasePath());
}

function schema(sqlite: Database.Database) {
    return sqlite
        .prepare(
            `SELECT type, name, sql FROM sqlite_master
             WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name`
        )
        .all();
}

async function main() {
    assert(
        process.env['IPTVNATOR_E2E_DATA_DIR'],
        'Never open the user database'
    );
    const [fixture, kind] = process.argv.slice(2);
    const indexed = kind === 'indexed';
    const warnings: unknown[][] = [];
    console.warn = (...args) => warnings.push(args);
    console.log = () => undefined;
    countRebuilds();

    const legacy = new Database(getDatabasePath());
    legacy.exec(readFileSync(fixture, 'utf8'));
    seed(legacy, indexed);
    legacy.close();
    const accented = ROWS / 4;

    // First launch after the upgrade: nothing re-indexed on this thread.
    let sqlite = await startup();
    assert.equal(
        rebuilds.length,
        0,
        'startup must leave the rebuild to the worker'
    );
    assert.equal(isContentTitleFtsBuildPending(sqlite), true);
    const live = (
        sqlite
            .prepare(
                `SELECT sql FROM sqlite_master WHERE name = 'content_title_fts'`
            )
            .get() as { sql: string }
    ).sql;
    assert.equal(live.includes('remove_diacritics'), false);
    // Search keeps the index 0.22 built; a 0.21 profile never had one.
    assert.equal(matches(sqlite, 'Amélie'), indexed ? accented : 0);

    // The worker starts, indexes two batches, and the app quits.
    buildContentTitleFtsBatch(sqlite, 5_000);
    buildContentTitleFtsBatch(sqlite, 5_000);
    sqlite.close();
    sqlite = await startup();
    assert.equal(rebuilds.length, 0);
    assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), '10000');

    // The next session's worker finishes it, with catalog writes between batches.
    for (let batch = 0; ; batch++) {
        if (batch === 3) {
            sqlite.exec(
                `UPDATE content SET title = 'Amélie renamed' WHERE id = 1`
            );
            sqlite.exec(`DELETE FROM content WHERE id = 4`);
            sqlite.exec(`INSERT INTO content (category_id, title, xtream_id, type)
                VALUES (1, 'Amélie appended', ${ROWS + 1}, 'movie')`);
        }
        if (buildContentTitleFtsBatch(sqlite, 5_000) === 'done') break;
    }
    sqlite.close();

    sqlite = await startup();
    const finished = schema(sqlite);
    assert.equal(isContentTitleFtsBuildPending(sqlite), false);
    assert.equal(count(sqlite, 'SELECT COUNT(*) AS n FROM content'), ROWS);
    assert.equal(matches(sqlite, 'amelie'), accented + 1);
    sqlite.exec(
        `INSERT INTO content_title_fts(content_title_fts, rank) VALUES ('integrity-check', 1)`
    );
    assert.deepEqual(sqlite.pragma('integrity_check'), [
        { integrity_check: 'ok' },
    ]);
    assert.equal(state(sqlite, CONTENT_TITLE_FTS_MIGRATION_KEY), 'done');
    assert.equal(
        state(sqlite, CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY),
        'done'
    );
    assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), undefined);
    assert.equal(
        count(
            sqlite,
            `SELECT COUNT(*) AS n FROM sqlite_master
             WHERE type = 'trigger' AND name GLOB 'content_title_fts_*'`
        ),
        3
    );
    sqlite.close();

    sqlite = await startup();
    assert.deepEqual(schema(sqlite), finished, 'repeated startup is stable');
    sqlite.close();
    assert.equal(rebuilds.length, 0);
    assert.deepEqual(warnings, []);
    process.stdout.write('upgrade verified');
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
