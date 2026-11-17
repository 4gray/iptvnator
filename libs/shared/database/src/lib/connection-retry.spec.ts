import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Runs under Electron's Node so better-sqlite3 loads with the ABI the app
 * ships. A failed initialization must not stick: every caller of the failed
 * attempt sees its rejection, the half-open handle is closed, and the next
 * call opens and migrates the file again.
 */
function retryScript(): string {
    const moduleUrl = (file: string) =>
        JSON.stringify(pathToFileURL(resolve(__dirname, file)).href);
    return `
        const assert = (await import('node:assert/strict')).default;
        const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
        const { sql } = await import('drizzle-orm');
        const { closeDatabase, getDatabase, getDatabasePath, initDatabase } =
            await import(${moduleUrl('connection.ts')});
        const { setDatabaseConnectionObserver } =
            await import(${moduleUrl('connection-observer.ts')});

        async function rejection(promise) {
            try {
                await promise;
            } catch (error) {
                return error;
            }
            assert.fail('initialization unexpectedly succeeded');
        }

        async function expectUsable() {
            const database = await getDatabase();
            const names = database
                .all(sql\`SELECT name FROM sqlite_master WHERE type = 'table'\`)
                .map(({ name }) => name);
            for (const table of ['playlists', 'favorites', 'downloads', 'app_state']) {
                assert.ok(names.includes(table), 'missing table ' + table);
            }
            database.run(
                sql\`INSERT INTO app_state (key, value) VALUES ('retry-probe', '1')\`
            );
            const row = database.get(
                sql\`SELECT value FROM app_state WHERE key = 'retry-probe'\`
            );
            assert.equal(row?.value, '1');
            assert.equal(await initDatabase(), database);
        }

        const path = getDatabasePath();

        // A directory where the file belongs makes the open itself throw.
        mkdirSync(path);
        const [first, concurrent] = await Promise.all([
            rejection(initDatabase()),
            rejection(getDatabase()),
        ]);
        assert.ok(first instanceof Error);
        assert.equal(concurrent, first);
        rmSync(path, { recursive: true });
        await expectUsable();
        closeDatabase();
        for (const suffix of ['', '-wal', '-shm']) {
            rmSync(path + suffix, { force: true });
        }

        // The constructor accepts a non-database file; the first pragma throws.
        writeFileSync(path, 'synthetic bytes that are not a SQLite database');
        const opened = [];
        setDatabaseConnectionObserver((connection) => opened.push(connection));
        await rejection(initDatabase());
        assert.equal(opened.length, 1);
        assert.equal(opened[0].open, false, 'half-open handle left open');
        rmSync(path);
        await expectUsable();
        assert.equal(opened.length, 2, 'retry did not open a new connection');
        setDatabaseConnectionObserver(null);
        closeDatabase();
        process.stdout.write('retry verified');
    `;
}

describe('database initialization retry after a failed attempt', () => {
    it('closes the failed handle and opens a migrated database on the next call', () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-retry-'));
        const electronPath = createRequire(__filename)('electron') as string;
        try {
            const output = execFileSync(
                electronPath,
                ['--import', 'tsx', '--eval', retryScript()],
                {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    timeout: 30_000,
                    env: {
                        ...process.env,
                        ELECTRON_RUN_AS_NODE: '1',
                        IPTVNATOR_E2E_DATA_DIR: dataDir,
                        TSX_TSCONFIG_PATH: resolve(
                            process.cwd(),
                            'tsconfig.base.json'
                        ),
                    },
                }
            );
            expect(output).toBe('retry verified');
        } finally {
            rmSync(dataDir, { recursive: true, force: true });
        }
    }, 35_000);
});
