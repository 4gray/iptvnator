import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { contentTitleFtsScenarios } from './testing/content-title-fts-scenarios';
import { openNodeSqlite } from './testing/node-sqlite-connection';
import { runElectronHarness } from './testing/run-electron-harness';

/**
 * The title index upgrade on real SQLite: the startup half, the batched
 * build the database worker runs, concurrent writes, an interrupted build
 * and an old runtime. See testing/content-title-fts-scenarios.ts.
 *
 * Each scenario runs twice: in this process on `node:sqlite`, which is what
 * the coverage report counts, and under Electron on better-sqlite3, the
 * module the app ships.
 */
const scenarios = Object.keys(contentTitleFtsScenarios);

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'iptvnator-fts-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('content title FTS index upgrade (node:sqlite)', () => {
    it.each(scenarios)('%s', (scenario) => {
        const opened: ReturnType<typeof openNodeSqlite>[] = [];
        try {
            contentTitleFtsScenarios[scenario](() => {
                const sqlite = openNodeSqlite(join(dir, 'fts.db'));
                sqlite.pragma('journal_mode = WAL');
                opened.push(sqlite);
                return sqlite;
            });
        } finally {
            for (const sqlite of opened) {
                try {
                    sqlite.close();
                } catch {
                    // Already closed by the scenario.
                }
            }
        }
    });
});

describe('content title FTS index upgrade (better-sqlite3 under Electron)', () => {
    it.each(scenarios)(
        '%s',
        async (scenario) => {
            const output = await runElectronHarness(
                resolve(
                    __dirname,
                    'testing/content-title-fts-scenarios-cli.ts'
                ),
                [scenario, dir],
                {
                    // Only the entry: the shared sources are counted in
                    // process above.
                    coverage: /content-title-fts-scenarios-cli[.]ts$/,
                    timeout: 30_000,
                }
            );
            expect(output).toBe('verified');
        },
        35_000
    );
});
