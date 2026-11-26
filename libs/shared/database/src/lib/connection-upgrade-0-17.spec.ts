import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Runs under Electron's Node so better-sqlite3 loads with the ABI the app
 * ships. A 0.17.1 library has no `categories.hidden` column, so the partial
 * `idx_categories_visible` index must wait for the column migration: created
 * with the tables, it fails the whole initialization and the library never
 * opens.
 */
function upgradeScript(): string {
    const moduleUrl = (file: string) =>
        JSON.stringify(pathToFileURL(resolve(__dirname, file)).href);
    const fixture = JSON.stringify(
        resolve(__dirname, 'testing/fixtures/v0.17.1-schema.sql')
    );
    return `
        const assert = (await import('node:assert/strict')).default;
        const { readFileSync } = await import('node:fs');
        const Database = (await import('better-sqlite3')).default;
        const { closeDatabase, getDatabasePath, initDatabase } =
            await import(${moduleUrl('connection.ts')});

        const tables = ['playlists', 'categories', 'content', 'favorites', 'recently_viewed'];
        const snapshot = (sqlite, columnsOf) =>
            tables.map((table) => {
                const columns = columnsOf[table].map((name) => '"' + name + '"');
                return sqlite
                    .prepare('SELECT ' + columns.join(', ') + ' FROM ' + table + ' ORDER BY id')
                    .all();
            });
        const columnNames = (sqlite, table) =>
            sqlite.pragma('table_info(' + table + ')').map(({ name }) => name);

        const path = getDatabasePath();
        const legacy = new Database(path);
        legacy.exec(readFileSync(${fixture}, 'utf8'));
        legacy.exec(\`
            INSERT INTO playlists (id, name, type, serverUrl, username, password)
            VALUES ('saved', 'Synthetic source', 'xtream', 'https://source.invalid',
                    'synthetic-user', 'synthetic-password');
            INSERT INTO categories (id, playlist_id, name, type, xtream_id)
            VALUES (1, 'saved', 'Movies', 'movies', 42);
            INSERT INTO content (id, category_id, title, xtream_id, type, added)
            VALUES (1, 1, 'Synthetic movie', 7, 'movie', '1700000000');
            INSERT INTO favorites (content_id, playlist_id) VALUES (1, 'saved');
            INSERT INTO recently_viewed (content_id, playlist_id) VALUES (1, 'saved');
        \`);
        const legacyColumns = Object.fromEntries(
            tables.map((table) => [table, columnNames(legacy, table)])
        );
        assert.ok(!legacyColumns.categories.includes('hidden'));
        const before = snapshot(legacy, legacyColumns);
        legacy.close();

        for (let startup = 0; startup < 2; startup++) {
            await initDatabase();
            closeDatabase();
            const sqlite = new Database(path, { readonly: true });
            try {
                assert.match(
                    String(
                        sqlite
                            .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_categories_visible'")
                            .get()?.sql
                    ),
                    /WHERE hidden = 0$/
                );
                assert.deepEqual(
                    sqlite.prepare('SELECT hidden FROM categories').all(),
                    [{ hidden: 0 }]
                );
                assert.deepEqual(snapshot(sqlite, legacyColumns), before);
                assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
                assert.deepEqual(sqlite.pragma('integrity_check'), [
                    { integrity_check: 'ok' },
                ]);
            } finally {
                sqlite.close();
            }
        }
        process.stdout.write('0.17 upgrade verified');
    `;
}

describe('database initialization upgraded straight from 0.17.1', () => {
    it('adds categories.hidden before its partial index and keeps the library', () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-upgrade-017-'));
        const electronPath = createRequire(__filename)('electron') as string;
        try {
            const output = execFileSync(
                electronPath,
                ['--import', 'tsx', '--eval', upgradeScript()],
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
            // Migrations log to stdout; the verdict is the last line.
            expect(output.split('\n').at(-1)).toBe('0.17 upgrade verified');
        } finally {
            rmSync(dataDir, { recursive: true, force: true });
        }
    }, 35_000);
});
