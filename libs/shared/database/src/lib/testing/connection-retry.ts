import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import {
    closeDatabase,
    getDatabase,
    getDatabasePath,
    initDatabase,
} from '../connection';
import { setDatabaseConnectionObserver } from '../connection-observer';

/**
 * Runs under Electron's Node (see connection-retry.spec.ts) so better-sqlite3
 * loads with the ABI the app ships. A failed initialization must not stick:
 * every caller of the failed attempt sees its rejection, the half-open
 * handle is closed, and the next call opens and migrates the file again.
 */
async function expectRejected(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        assert.ok(error instanceof Error);
        return error;
    }
    assert.fail('initialization unexpectedly succeeded');
}

async function expectUsable(): Promise<void> {
    const database = await getDatabase();
    const tables = database.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table'`
    );
    const names = tables.map(({ name }) => name);
    for (const table of ['playlists', 'favorites', 'downloads', 'app_state']) {
        assert.ok(names.includes(table), `missing table ${table}`);
    }
    database.run(
        sql`INSERT INTO app_state (key, value) VALUES ('retry-probe', '1')`
    );
    const row = database.get<{ value: string }>(
        sql`SELECT value FROM app_state WHERE key = 'retry-probe'`
    );
    assert.equal(row?.value, '1');
    assert.equal(await initDatabase(), database);
}

async function openFailureIsNotSticky(path: string): Promise<void> {
    // A directory where the file belongs makes the open itself throw.
    mkdirSync(path);
    const first = initDatabase();
    const concurrent = getDatabase();
    const [firstError, concurrentError] = await Promise.all([
        expectRejected(first),
        expectRejected(concurrent),
    ]);
    assert.equal(concurrentError, firstError);
    rmSync(path, { recursive: true });
    await expectUsable();
    closeDatabase();
}

async function halfOpenHandleIsClosed(path: string): Promise<void> {
    // The constructor accepts a non-database file; the first pragma throws.
    writeFileSync(path, 'synthetic bytes that are not a SQLite database');
    const opened: Database.Database[] = [];
    setDatabaseConnectionObserver((connection) => opened.push(connection));
    try {
        await expectRejected(initDatabase());
        assert.equal(opened.length, 1);
        assert.equal(opened[0].open, false, 'half-open handle left open');
        rmSync(path);
        await expectUsable();
        assert.equal(opened.length, 2, 'retry did not open a new connection');
    } finally {
        setDatabaseConnectionObserver(null);
        closeDatabase();
    }
}

async function main(): Promise<void> {
    const path = getDatabasePath();
    await openFailureIsNotSticky(path);
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
    await halfOpenHandleIsClosed(path);
    process.stdout.write('retry verified');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
