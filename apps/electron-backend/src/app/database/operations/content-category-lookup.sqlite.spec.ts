import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

it('keeps a typed duplicate inside the requested category and source on SQLite', () => {
    const moduleUrl = (path: string) =>
        pathToFileURL(resolve(process.cwd(), path)).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(moduleUrl('libs/shared/database/src/lib/connection.ts'))});
        const { getContentByXtreamId: lookup } = await import(${JSON.stringify(moduleUrl('apps/electron-backend/src/app/database/operations/content-identity-lookup.ts'))});
        const sqlite = new Database(':memory:');
        for (const statement of [...hooks.createTableStatements, ...hooks.columnMigrationStatements]) {
            try { sqlite.exec(statement); } catch (error) { if (!String(error).includes('duplicate column name')) throw error; }
        }
        const db = drizzle(sqlite, { schema });
        db.insert(schema.playlists).values([
            { id: 'synthetic-a', name: 'Synthetic Source A', type: 'xtream' },
            { id: 'synthetic-b', name: 'Synthetic Source B', type: 'xtream' },
        ]).run();
        db.insert(schema.categories).values([
            { id: 7, playlistId: 'synthetic-a', xtreamId: 201, name: 'Synthetic A', type: 'movies' },
            { id: 8, playlistId: 'synthetic-a', xtreamId: 202, name: 'Synthetic B', type: 'movies' },
            { id: 9, playlistId: 'synthetic-b', xtreamId: 201, name: 'Synthetic C', type: 'movies' },
        ]).run();
        db.insert(schema.content).values([
            { id: 71, categoryId: 7, xtreamId: 42, title: 'Synthetic Film', type: 'movie' },
            { id: 81, categoryId: 8, xtreamId: 42, title: 'Synthetic Film', type: 'movie' },
            { id: 91, categoryId: 9, xtreamId: 42, title: 'Synthetic Film', type: 'movie' },
            { id: 82, categoryId: 8, xtreamId: 43, title: 'Synthetic Series', type: 'series' },
        ]).run();
        const results = [];
        for (const [id, owner, type, category] of [
            [42, 'synthetic-a', 'movie', 8],
            [42, 'synthetic-a', 'movie', 9],
            [43, 'synthetic-a', 'movie', 8],
            [42, 'synthetic-a', 'movie', 201],
            [42, 'synthetic-a', 'movie', undefined],
            [42, 'synthetic-a', 'movie', -1],
        ]) results.push((await lookup(db, id, owner, type, undefined, category))?.id ?? null);
        const { setParentalLockActive } = await import(${JSON.stringify(moduleUrl('apps/electron-backend/src/app/database/parental-lock-state.ts'))});
        setParentalLockActive(true);
        sqlite.exec('UPDATE categories SET locked = 1 WHERE id = 7');
        results.push((await lookup(db, 42, 'synthetic-a', 'movie', undefined, undefined, true))?.id ?? null);
        results.push((await lookup(db, 42, 'synthetic-a', 'movie'))?.id ?? null);
        sqlite.exec('UPDATE categories SET locked = 1 WHERE id = 8');
        results.push((await lookup(db, 42, 'synthetic-a', 'movie', undefined, undefined, true))?.id ?? null);
        setParentalLockActive(false);
        results.push((await lookup(db, 42, 'synthetic-a', 'movie', undefined, undefined, true))?.id ?? null);
        console.log(JSON.stringify(results));
        sqlite.close();
    `;
    const results = JSON.parse(
        execFileSync(
            createRequire(__filename)('electron'),
            ['--import', 'tsx', '--eval', script],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    TSX_TSCONFIG_PATH: resolve(
                        process.cwd(),
                        'tsconfig.base.json'
                    ),
                },
            }
        )
    );
    expect(results).toEqual([81, null, null, null, 71, null, 81, 71, null, 71]);
});
