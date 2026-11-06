import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('Xtream import persistence with real SQLite', () => {
    let directory: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'xtream-import-recovery-'));
    });

    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    function run(script: string): string {
        const url = (file: string) => pathToFileURL(resolve(file)).href;
        const bootstrap = `
            const { default: Database } = await import('better-sqlite3');
            const { drizzle } = await import('drizzle-orm/better-sqlite3');
            const schema = await import('@iptvnator/shared/database/schema');
            const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(url('libs/shared/database/src/lib/connection.ts'))});
            const { saveContent, clearXtreamImportCache } = await import(${JSON.stringify(url(join(__dirname, 'content.operations.ts')))});
            const { saveCategories } = await import(${JSON.stringify(url(join(__dirname, 'category.operations.ts')))});
            const { getAppState } = await import(${JSON.stringify(url(join(__dirname, 'playlist.operations.ts')))});
            const sqlite = new Database(${JSON.stringify(join(directory, 'fixture.db'))});
            sqlite.pragma('journal_mode = WAL');
            sqlite.pragma('foreign_keys = ON');
            for (const statement of [...hooks.createTableStatements, ...hooks.columnMigrationStatements]) {
                try { sqlite.exec(statement); } catch (error) {
                    if (!String(error).includes('duplicate column name')) throw error;
                }
            }
            const db = drizzle(sqlite, { schema });
            const marker = 'xtream-import-status:p:live';
            const categories = [{ category_id: '1', category_name: 'Synthetic category' }];
            const streams = Array.from({ length: 10000 }, (_, i) => ({
                category_id: '1', stream_id: i + 1, name: 'Synthetic item ' + i
            }));
        `;
        try {
            return execFileSync(
                createRequire(__filename)('electron'),
                ['--import', 'tsx', '--eval', bootstrap + script],
                {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    stdio: 'pipe',
                    env: {
                        ...process.env,
                        ELECTRON_RUN_AS_NODE: '1',
                        TSX_TSCONFIG_PATH: resolve('tsconfig.base.json'),
                    },
                }
            );
        } catch {
            throw new Error('Synthetic Xtream SQLite import fixture failed.');
        }
    }

    it('recovers the full first import after process exit between committed chunks', () => {
        run(`
            db.insert(schema.playlists).values({ id: 'p', name: 'Synthetic source', type: 'xtream' }).run();
            await saveCategories(db, 'p', categories, 'live');
            await saveContent(db, 'p', streams, 'live', {
                onProgress(progress) { if (progress.current === 5000) process.exit(0); }
            });
            throw new Error('The fixture did not exit after the first commit.');
        `);
        const result = JSON.parse(
            run(`
            const status = await getAppState(db, marker);
            const before = sqlite.prepare('SELECT count(*) AS n FROM content').get().n;
            if (status === 'importing') await clearXtreamImportCache(db, 'p', 'live');
            await saveCategories(db, 'p', categories, 'live');
            await saveContent(db, 'p', streams, 'live');
            const after = sqlite.prepare('SELECT count(*) AS n FROM content').get().n;
            sqlite.close();
            console.log(JSON.stringify({ status, before, after }));
        `)
        );
        expect(result).toEqual({
            status: 'importing',
            before: 5000,
            after: 10000,
        });
    });

    it('imports 6,000 categories in provider order and preserves visibility and locks', () => {
        const result = JSON.parse(
            run(`
            db.insert(schema.playlists).values({ id: 'p', name: 'Synthetic source', type: 'xtream' }).run();
            const rows = Array.from({ length: 6000 }, (_, i) => ({
                category_id: String(i + 1), category_name: 'Synthetic category ' + i
            }));
            await saveCategories(db, 'p', rows, 'live', [2], [3]);
            const saved = sqlite.prepare('SELECT xtream_id, hidden, locked FROM categories ORDER BY id').all();
            sqlite.close();
            console.log(JSON.stringify({ count: saved.length, first: saved.slice(0, 3), last: saved.at(-1).xtream_id }));
        `)
        );
        expect(result).toEqual({
            count: 6000,
            first: [
                { xtream_id: 1, hidden: 0, locked: 0 },
                { xtream_id: 2, hidden: 1, locked: 0 },
                { xtream_id: 3, hidden: 0, locked: 1 },
            ],
            last: 6000,
        });
    });

    it('rolls back earlier category batches when a later batch fails', () => {
        const result = JSON.parse(
            run(`
            db.insert(schema.playlists).values({ id: 'p', name: 'Synthetic source', type: 'xtream' }).run();
            sqlite.exec("CREATE TRIGGER fail_category BEFORE INSERT ON categories WHEN NEW.xtream_id = 1501 BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END");
            let failed = false;
            try {
                await saveCategories(db, 'p', Array.from({ length: 2000 }, (_, i) => ({ category_id: i + 1, category_name: 'Synthetic' })), 'live');
            } catch { failed = true; }
            const count = sqlite.prepare('SELECT count(*) AS n FROM categories').get().n;
            sqlite.close();
            console.log(JSON.stringify({ failed, count }));
        `)
        );
        expect(result).toEqual({ failed: true, count: 0 });
    });
});
