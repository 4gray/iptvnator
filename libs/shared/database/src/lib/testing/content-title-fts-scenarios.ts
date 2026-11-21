/**
 * Real-SQLite scenarios for content-title-fts.ts, one per process. Run under
 * Electron as Node (better-sqlite3 is built for Electron's ABI) by
 * content-title-fts.spec.ts:
 *
 *   electron --import tsx content-title-fts-scenarios.ts <scenario> <dir>
 *
 * Prints `verified` on success. Synthetic titles only.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
    buildContentTitleFtsBatch,
    CONTENT_TITLE_FTS_BUILD_CURSOR_KEY,
    CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY,
    CONTENT_TITLE_FTS_MIGRATION_KEY,
    contentTitleFtsStatement,
    CONTENT_TITLE_FTS_TRIGGER_STATEMENTS,
    isContentTitleFtsBuildPending,
    prepareContentTitleFts,
} from '../content-title-fts';

type Sqlite = Database.Database;
const ROWS = 120;
const LIMIT = { startupRebuildLimit: 50 };

function open(dir: string): Sqlite {
    const sqlite = new Database(join(dir, 'fts.db'));
    sqlite.pragma('journal_mode = WAL');
    return sqlite;
}

/** A catalog as 0.22 (`indexed`) or 0.21 (`unindexed`) left it. */
function legacyProfile(sqlite: Sqlite, kind: 'indexed' | 'unindexed') {
    sqlite.exec(`CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')))`);
    sqlite.exec(`CREATE TABLE content (id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL)`);
    const insert = sqlite.prepare(
        `INSERT INTO content (id, title) VALUES (?, ?)`
    );
    for (let id = 1; id <= ROWS; id++) {
        insert.run(id, id % 3 === 0 ? `Amélie ${id}` : `Synthetic ${id}`);
    }
    // What createTables() declares on every start.
    sqlite.exec(contentTitleFtsStatement(false));
    if (kind === 'indexed') {
        sqlite.exec(
            `INSERT INTO content_title_fts(content_title_fts) VALUES ('rebuild')`
        );
        sqlite
            .prepare(`INSERT INTO app_state (key, value) VALUES (?, 'done')`)
            .run(CONTENT_TITLE_FTS_MIGRATION_KEY);
    }
    for (const statement of CONTENT_TITLE_FTS_TRIGGER_STATEMENTS) {
        sqlite.exec(statement);
    }
}

function state(sqlite: Sqlite, key: string): string | undefined {
    return (
        sqlite.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key) as
            { value: string } | undefined
    )?.value;
}

function liveSql(sqlite: Sqlite): string {
    return (
        sqlite
            .prepare(
                `SELECT sql FROM sqlite_master WHERE name = 'content_title_fts'`
            )
            .get() as { sql: string }
    ).sql;
}

function match(sqlite: Sqlite, query: string): number[] {
    return (
        sqlite
            .prepare(
                `SELECT rowid FROM content_title_fts WHERE content_title_fts MATCH ?
                 ORDER BY rowid`
            )
            .all(query) as { rowid: number }[]
    ).map(({ rowid }) => rowid);
}

function expected(sqlite: Sqlite, pattern: RegExp): number[] {
    return (
        sqlite.prepare(`SELECT id, title FROM content ORDER BY id`).all() as {
            id: number;
            title: string;
        }[]
    )
        .filter(({ title }) => pattern.test(title))
        .map(({ id }) => id);
}

function buildToEnd(sqlite: Sqlite, onBatch?: (batch: number) => void): number {
    let batches = 0;
    for (;;) {
        const result = buildContentTitleFtsBatch(sqlite, 25);
        if (result === 'done') return batches;
        assert.equal(result, 'pending');
        batches++;
        onBatch?.(batches);
    }
}

/** The swapped-in index: folded, consistent with content, fed by triggers. */
function verifyFinished(sqlite: Sqlite, folded = true) {
    assert.equal(isContentTitleFtsBuildPending(sqlite), false);
    assert.equal(liveSql(sqlite).includes('remove_diacritics'), folded);
    sqlite.exec(
        `INSERT INTO content_title_fts(content_title_fts, rank) VALUES ('integrity-check', 1)`
    );
    assert.equal(state(sqlite, CONTENT_TITLE_FTS_MIGRATION_KEY), 'done');
    assert.equal(
        state(sqlite, CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY),
        folded ? 'done' : undefined
    );
    assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), undefined);
    const triggers = sqlite
        .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`
        )
        .all() as { name: string }[];
    assert.deepEqual(
        triggers.map(({ name }) => name),
        ['content_title_fts_ad', 'content_title_fts_ai', 'content_title_fts_au']
    );
    sqlite
        .prepare(`INSERT INTO content (title) VALUES ('Amélie after swap')`)
        .run();
    assert.deepEqual(
        match(sqlite, folded ? 'amelie' : 'Amélie'),
        expected(sqlite, /Amélie/)
    );
    assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'current');
}

/** Writes on both sides of the cursor, from another connection. */
function writeDuringBuild(writer: Sqlite) {
    writer.exec(`UPDATE content SET title = 'Amélie renamed' WHERE id = 1`);
    writer.exec(`UPDATE content SET title = 'Amélie late' WHERE id = 100`);
    writer.exec(`UPDATE content SET title = 'Plain now' WHERE id = 3`);
    writer.exec(`DELETE FROM content WHERE id IN (6, 99)`);
    writer.exec(`INSERT INTO content (id, title) VALUES (6, 'Amélie reused')`);
    writer.exec(`INSERT INTO content (title) VALUES ('Amélie appended')`);
}

const scenarios: Record<string, (dir: string) => void> = {
    'small catalog rebuilds at startup': (dir) => {
        const sqlite = open(dir);
        legacyProfile(sqlite, 'indexed');
        assert.equal(prepareContentTitleFts(sqlite), 'rebuilt');
        verifyFinished(sqlite);
    },
    'kill switch rebuilds a large catalog at startup': (dir) => {
        const sqlite = open(dir);
        legacyProfile(sqlite, 'indexed');
        assert.equal(
            prepareContentTitleFts(sqlite, { startupRebuildLimit: Infinity }),
            'rebuilt'
        );
        verifyFinished(sqlite);
    },
    'large 0.22 catalog builds in batches beside the live index': (dir) => {
        const sqlite = open(dir);
        legacyProfile(sqlite, 'indexed');
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        // Search keeps the live, unfolded index meanwhile.
        assert.equal(liveSql(sqlite).includes('remove_diacritics'), false);
        assert.deepEqual(match(sqlite, 'Amélie'), expected(sqlite, /Amélie/));
        assert.deepEqual(match(sqlite, 'amelie'), []);
        const writer = open(dir);
        buildToEnd(sqlite, (batch) => {
            if (batch === 2) writeDuringBuild(writer);
            // The live index stays complete through the build.
            assert.deepEqual(
                match(sqlite, 'Amélie'),
                expected(sqlite, /Amélie/)
            );
        });
        writer.close();
        verifyFinished(sqlite);
    },
    'interrupted build keeps the live index and resumes': (dir) => {
        let sqlite = open(dir);
        legacyProfile(sqlite, 'indexed');
        prepareContentTitleFts(sqlite, LIMIT);
        buildContentTitleFtsBatch(sqlite, 25);
        buildContentTitleFtsBatch(sqlite, 25);
        // Terminated inside the third batch: its transaction never commits.
        sqlite.exec('BEGIN IMMEDIATE');
        sqlite.exec(
            `INSERT INTO content_title_fts_next(rowid, title)
             SELECT id, title FROM content WHERE id > 50 AND id <= 75`
        );
        sqlite.close();

        sqlite = open(dir);
        assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), '50');
        assert.deepEqual(match(sqlite, 'Amélie'), expected(sqlite, /Amélie/));
        sqlite.exec(`UPDATE content SET title = 'Amélie between' WHERE id = 2`);
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), '50');
        assert.equal(buildToEnd(sqlite), 3);
        verifyFinished(sqlite);
    },
    'large 0.21 catalog without an index stays consistent': (dir) => {
        const sqlite = open(dir);
        legacyProfile(sqlite, 'unindexed');
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        // The never-built live index takes no deletes it cannot verify.
        const live = sqlite
            .prepare(
                `SELECT COUNT(*) AS n FROM sqlite_master
                 WHERE type = 'trigger' AND name GLOB 'content_title_fts_a?'`
            )
            .get() as { n: number };
        assert.equal(live.n, 0);
        const writer = open(dir);
        buildToEnd(sqlite, (batch) => {
            if (batch === 1) writeDuringBuild(writer);
        });
        writer.close();
        verifyFinished(sqlite);
    },
    'runtime without diacritic folding builds the plain index': (dir) => {
        const sqlite = open(dir);
        legacyProfile(sqlite, 'unindexed');
        const exec = sqlite.exec.bind(sqlite);
        sqlite.exec = ((sql: string) => {
            if (sql.includes('remove_diacritics')) {
                throw new Error('parse error in tokenize directive');
            }
            return exec(sql);
        }) as typeof sqlite.exec;
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        buildToEnd(sqlite);
        verifyFinished(sqlite, false);
    },
    'a done marker over an unfolded live index is not trusted': (dir) => {
        const sqlite = open(dir);
        legacyProfile(sqlite, 'indexed');
        sqlite
            .prepare(`INSERT INTO app_state (key, value) VALUES (?, 'done')`)
            .run(CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY);
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        buildToEnd(sqlite);
        verifyFinished(sqlite);
    },
};

const run = scenarios[process.argv[2]];
assert(run, `Unknown scenario: ${process.argv[2]}`);
run(process.argv[3]);
process.stdout.write('verified');
