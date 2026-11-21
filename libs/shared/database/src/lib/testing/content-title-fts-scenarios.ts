/**
 * Real-SQLite scenarios for content-title-fts.ts, run one per process by
 * content-title-fts-scenarios-cli.ts. `open` returns a new connection to the
 * same WAL database on every call. Synthetic titles only.
 */
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
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

export type OpenScenarioDatabase = () => Sqlite;

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

/** Makes `exec` throw for SQL containing `fragment`; returns the undo. */
function failExec(sqlite: Sqlite, fragment: string): () => void {
    const exec = sqlite.exec;
    sqlite.exec = ((sql: string) => {
        if (sql.includes(fragment)) {
            throw new Error('parse error in tokenize directive');
        }
        return exec.call(sqlite, sql);
    }) as typeof sqlite.exec;
    return () => {
        sqlite.exec = exec;
    };
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

export const contentTitleFtsScenarios: Record<
    string,
    (open: OpenScenarioDatabase) => void
> = {
    'small catalog rebuilds at startup': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'indexed');
        assert.equal(prepareContentTitleFts(sqlite), 'rebuilt');
        verifyFinished(sqlite);
    },
    'kill switch rebuilds a large catalog at startup': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'indexed');
        assert.equal(
            prepareContentTitleFts(sqlite, { startupRebuildLimit: Infinity }),
            'rebuilt'
        );
        verifyFinished(sqlite);
    },
    'large 0.22 catalog builds in batches beside the live index': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'indexed');
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        // Search keeps the live, unfolded index meanwhile.
        assert.equal(liveSql(sqlite).includes('remove_diacritics'), false);
        assert.deepEqual(match(sqlite, 'Amélie'), expected(sqlite, /Amélie/));
        assert.deepEqual(match(sqlite, 'amelie'), []);
        const writer = open();
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
    'interrupted build keeps the live index and resumes': (open) => {
        let sqlite = open();
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

        sqlite = open();
        assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), '50');
        assert.deepEqual(match(sqlite, 'Amélie'), expected(sqlite, /Amélie/));
        sqlite.exec(`UPDATE content SET title = 'Amélie between' WHERE id = 2`);
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), '50');
        assert.equal(buildToEnd(sqlite), 3);
        verifyFinished(sqlite);
    },
    'large 0.21 catalog without an index stays consistent': (open) => {
        const sqlite = open();
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
        const writer = open();
        buildToEnd(sqlite, (batch) => {
            if (batch === 1) writeDuringBuild(writer);
        });
        writer.close();
        verifyFinished(sqlite);
    },
    'runtime without diacritic folding builds the plain index': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'unindexed');
        failExec(sqlite, 'remove_diacritics');
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        buildToEnd(sqlite);
        verifyFinished(sqlite, false);
    },
    'a done marker over an unfolded live index is not trusted': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'indexed');
        sqlite
            .prepare(`INSERT INTO app_state (key, value) VALUES (?, 'done')`)
            .run(CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY);
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        buildToEnd(sqlite);
        verifyFinished(sqlite);
    },
    'a leftover build beside a current index is discarded': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'indexed');
        assert.equal(prepareContentTitleFts(sqlite), 'rebuilt');
        sqlite.exec(contentTitleFtsStatement(true, 'content_title_fts_next'));
        assert.equal(isContentTitleFtsBuildPending(sqlite), true);
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'current');
        assert.equal(isContentTitleFtsBuildPending(sqlite), false);
        assert.equal(buildContentTitleFtsBatch(sqlite, 25), 'idle');
        verifyFinished(sqlite);
    },
    'a build that lost its cursor starts over': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'indexed');
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        buildContentTitleFtsBatch(sqlite, 25);
        sqlite
            .prepare(`DELETE FROM app_state WHERE key = ?`)
            .run(CONTENT_TITLE_FTS_BUILD_CURSOR_KEY);
        // Never swapped in: the partial index is dropped, the live one stays.
        assert.equal(buildContentTitleFtsBatch(sqlite, 25), 'idle');
        assert.equal(isContentTitleFtsBuildPending(sqlite), false);
        assert.equal(liveSql(sqlite).includes('remove_diacritics'), false);
        assert.deepEqual(match(sqlite, 'Amélie'), expected(sqlite, /Amélie/));
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), '0');
        buildToEnd(sqlite);
        verifyFinished(sqlite);
    },
    'a plain build left by an older runtime restarts folded': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'unindexed');
        const restore = failExec(sqlite, 'remove_diacritics');
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        buildContentTitleFtsBatch(sqlite, 25);
        restore();
        // The runtime can fold now: the plain half-build is not resumed.
        assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'deferred');
        assert.equal(state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY), '0');
        buildToEnd(sqlite);
        verifyFinished(sqlite);
    },
    'a failed upgrade leaves the live index untouched': (open) => {
        const sqlite = open();
        legacyProfile(sqlite, 'indexed');
        const warn = console.warn;
        const warnings: unknown[] = [];
        console.warn = (message: unknown) => warnings.push(message);
        try {
            failExec(
                sqlite,
                'CREATE TRIGGER IF NOT EXISTS content_title_fts_next_au'
            );
            assert.equal(prepareContentTitleFts(sqlite, LIMIT), 'failed');
        } finally {
            console.warn = warn;
        }
        assert.equal(warnings.length, 1);
        // The transaction rolled back: no half-created build or cursor.
        assert.equal(isContentTitleFtsBuildPending(sqlite), false);
        assert.equal(
            state(sqlite, CONTENT_TITLE_FTS_BUILD_CURSOR_KEY),
            undefined
        );
        assert.equal(
            state(sqlite, CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY),
            undefined
        );
        assert.deepEqual(match(sqlite, 'Amélie'), expected(sqlite, /Amélie/));
    },
};
