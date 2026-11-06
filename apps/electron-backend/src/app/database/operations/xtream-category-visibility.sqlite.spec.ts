import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const cases = [
    'explicit-unhide-records-false',
    'explicit-write-confirms-native-recording',
    'typed-identities-stay-distinct',
    'ordinary-updates-do-not-rewrite-intent',
    'source-ownership-stays-isolated',
    'native-crash-keeps-committed-intent',
    'cache-invalidation-retains-intent',
    'reimport-unhide-overrides-stale-hidden-list',
    'reimport-hide-overrides-default-visible',
    'missing-categories-retain-their-intent',
    'later-returning-category-applies-intent',
    'ledger-write-failure-rolls-back-visibility',
    'visibility-write-failure-keeps-ledger',
    'stale-category-identities-roll-back-the-whole-edit',
    'malformed-ledger-blocks-explicit-update',
    'malformed-ledger-blocks-import',
    'fresh-backup-reset-removes-old-intent',
    'source-deletion-clears-only-owned-intent',
    'global-deletion-clears-remaining-intent',
] as const;

describe('durable explicit category visibility on historical SQLite', () => {
    let results: Record<string, boolean>;

    beforeAll(() => {
        const directory = mkdtempSync(join(tmpdir(), 'synthetic-visibility-'));
        const url = (path: string) => pathToFileURL(resolve(path)).href;
        const bootstrap = `
            const { default: Database } = await import('better-sqlite3');
            const { drizzle } = await import('drizzle-orm/better-sqlite3');
            const schema = await import('@iptvnator/shared/database/schema');
            const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(url('libs/shared/database/src/lib/connection.ts'))});
            const { saveCategories, getAllCategories, updateCategoryVisibility } = await import(${JSON.stringify(url(resolve(__dirname, 'category.operations.ts')))});
            const { getAppState, setAppState, deletePlaylist, deleteAllPlaylists } = await import(${JSON.stringify(url(resolve(__dirname, 'playlist.operations.ts')))});
            const { deleteXtreamContent } = await import(${JSON.stringify(url(resolve(__dirname, 'xtream.operations.ts')))});
            const sqlite = new Database(${JSON.stringify(join(directory, 'fixture.db'))});
            sqlite.pragma('journal_mode = WAL');
            sqlite.pragma('foreign_keys = ON');
            for (const statement of [...hooks.createTableStatements, ...hooks.columnMigrationStatements]) {
                try { sqlite.exec(statement); } catch (error) {
                    if (!String(error).includes('duplicate column name')) throw error;
                }
            }
            const db = drizzle(sqlite, { schema });
            const key = id => 'xtream-category-visibility:' + id;
            const ledger = async id => {
                const raw = await getAppState(db, key(id));
                return raw ? JSON.parse(raw) : null;
            };
            const records = state => state?.categories ?? [];
        `;
        const producer =
            bootstrap +
            `
            const results = {};
            db.insert(schema.playlists).values(['p', 'q'].map(id => ({ id, name: 'Synthetic source ' + id, type: 'xtream' }))).run();
            db.insert(schema.categories).values([
                { id: 1, playlistId: 'p', xtreamId: 91, name: 'Synthetic movie category', type: 'movies', hidden: true },
                { id: 2, playlistId: 'p', xtreamId: 91, name: 'Synthetic live category', type: 'live', hidden: false },
                { id: 3, playlistId: 'p', xtreamId: 92, name: 'Synthetic series category', type: 'series', hidden: true },
                { id: 4, playlistId: 'q', xtreamId: 91, name: 'Synthetic other category', type: 'movies', hidden: false }
            ]).run();
            const explicitResult = await updateCategoryVisibility(db, [1], false, true);
            results['explicit-write-confirms-native-recording'] = explicitResult.success === true && explicitResult.explicitRecorded === true;
            await updateCategoryVisibility(db, [2], true, true);
            await updateCategoryVisibility(db, [3], false, true);
            await updateCategoryVisibility(db, [4], true, true);
            const p = await ledger('p');
            const q = await ledger('q');
            results['explicit-unhide-records-false'] = records(p).some(row => row.categoryType === 'movies' && row.xtreamId === 91 && row.hidden === false);
            results['typed-identities-stay-distinct'] = records(p).some(row => row.categoryType === 'live' && row.xtreamId === 91 && row.hidden === true) && results['explicit-unhide-records-false'];
            const before = await getAppState(db, key('p'));
            await updateCategoryVisibility(db, [2], false);
            results['ordinary-updates-do-not-rewrite-intent'] = !!p && before === await getAppState(db, key('p'));
            results['source-ownership-stays-isolated'] = records(q).length === 1 && records(q)[0].hidden === true && records(p).length === 3;
            const { writeFileSync } = await import('node:fs');
            writeFileSync(${JSON.stringify(join(directory, 'producer.json'))}, JSON.stringify(results));
            process.kill(process.pid, 'SIGKILL');
        `;
        const consumer =
            bootstrap +
            `
            const { readFileSync } = await import('node:fs');
            const results = JSON.parse(readFileSync(${JSON.stringify(join(directory, 'producer.json'))}, 'utf8'));
            results['native-crash-keeps-committed-intent'] = records(await ledger('p')).some(row => row.categoryType === 'movies' && row.xtreamId === 91 && row.hidden === false) && (await getAllCategories(db, 'p', 'movies'))[0].hidden === false;
            const beforeDelete = await getAppState(db, key('p'));
            await deleteXtreamContent(db, 'p');
            results['cache-invalidation-retains-intent'] = !!beforeDelete && beforeDelete === await getAppState(db, key('p'));
            await saveCategories(db, 'p', [{ category_id: '91', category_name: 'Synthetic movie return' }], 'movies', [91]);
            await saveCategories(db, 'p', [{ category_id: '91', category_name: 'Synthetic live return' }], 'live', []);
            await saveCategories(db, 'p', [{ category_id: '94', category_name: 'Synthetic series placeholder' }], 'series', []);
            let movie = (await getAllCategories(db, 'p', 'movies'))[0];
            results['reimport-unhide-overrides-stale-hidden-list'] = movie.hidden === false;
            results['reimport-hide-overrides-default-visible'] = (await getAllCategories(db, 'p', 'live'))[0].hidden === true;
            results['missing-categories-retain-their-intent'] = records(await ledger('p')).some(row => row.categoryType === 'series' && row.xtreamId === 92 && row.hidden === false);
            await deleteXtreamContent(db, 'p', undefined, undefined, ['series']);
            await saveCategories(db, 'p', [{ category_id: '92', category_name: 'Synthetic series return' }], 'series', [92]);
            results['later-returning-category-applies-intent'] = (await getAllCategories(db, 'p', 'series'))[0].hidden === false;
            const beforeFault = await getAppState(db, key('p'));
            const beforeHidden = movie.hidden;
            sqlite.exec("CREATE TRIGGER synthetic_ledger_fault BEFORE INSERT ON app_state WHEN NEW.key LIKE 'xtream-category-visibility:%' BEGIN SELECT RAISE(ABORT, 'synthetic ledger fault'); END");
            let rejected = false;
            try { await updateCategoryVisibility(db, [movie.id], !beforeHidden, true); } catch { rejected = true; }
            sqlite.exec('DROP TRIGGER synthetic_ledger_fault');
            movie = (await getAllCategories(db, 'p', 'movies'))[0];
            results['ledger-write-failure-rolls-back-visibility'] = rejected && movie.hidden === beforeHidden && beforeFault === await getAppState(db, key('p'));
            sqlite.exec("CREATE TRIGGER synthetic_visibility_fault BEFORE UPDATE ON categories WHEN NEW.hidden != OLD.hidden BEGIN SELECT RAISE(ABORT, 'synthetic visibility fault'); END");
            rejected = false;
            try { await updateCategoryVisibility(db, [movie.id], !movie.hidden, true); } catch { rejected = true; }
            sqlite.exec('DROP TRIGGER synthetic_visibility_fault');
            results['visibility-write-failure-keeps-ledger'] = rejected && beforeFault === await getAppState(db, key('p'));
            rejected = false;
            try { await updateCategoryVisibility(db, [movie.id, 9999999], !movie.hidden, true); } catch { rejected = true; }
            results['stale-category-identities-roll-back-the-whole-edit'] = rejected && (await getAllCategories(db, 'p', 'movies'))[0].hidden === movie.hidden && beforeFault === await getAppState(db, key('p'));
            await setAppState(db, key('p'), '{broken');
            rejected = false;
            try { await updateCategoryVisibility(db, [movie.id], !movie.hidden, true); } catch { rejected = true; }
            results['malformed-ledger-blocks-explicit-update'] = rejected && (await getAllCategories(db, 'p', 'movies'))[0].hidden === movie.hidden;
            await setAppState(db, key('p'), beforeFault ?? '');
            db.insert(schema.playlists).values({ id: 'r', name: 'Synthetic unreadable ledger source', type: 'xtream' }).run();
            await setAppState(db, key('r'), '{broken');
            rejected = false;
            try { await saveCategories(db, 'r', [{ category_id: '93', category_name: 'Synthetic failed import' }], 'live', []); } catch { rejected = true; }
            results['malformed-ledger-blocks-import'] = rejected && (await getAllCategories(db, 'r', 'live')).length === 0;
            await setAppState(db, key('p'), '');
            await deleteXtreamContent(db, 'p', undefined, undefined, ['movie']);
            await saveCategories(db, 'p', [{ category_id: '91', category_name: 'Synthetic fresh archive category' }], 'movies', [91]);
            movie = (await getAllCategories(db, 'p', 'movies'))[0];
            results['fresh-backup-reset-removes-old-intent'] = movie.hidden === true && await getAppState(db, key('p')) === '';
            await updateCategoryVisibility(db, [movie.id], false, true);
            await deletePlaylist(db, 'p');
            results['source-deletion-clears-only-owned-intent'] = await getAppState(db, key('p')) === null && !!(await getAppState(db, key('q')));
            await deleteAllPlaylists(db);
            results['global-deletion-clears-remaining-intent'] = await getAppState(db, key('q')) === null;
            sqlite.close();
            console.log(JSON.stringify(results));
        `;
        const executable = createRequire(__filename)('electron');
        const options = {
            cwd: process.cwd(),
            encoding: 'utf8' as const,
            stdio: 'pipe' as const,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                TSX_TSCONFIG_PATH: resolve(process.cwd(), 'tsconfig.base.json'),
            },
        };
        try {
            const crashed = spawnSync(
                executable,
                ['--import', 'tsx', '--eval', producer],
                options
            );
            if (crashed.status === 0)
                throw new Error(
                    'Synthetic producer did not terminate abruptly.'
                );
            JSON.parse(readFileSync(join(directory, 'producer.json'), 'utf8'));
            results = JSON.parse(
                execFileSync(
                    executable,
                    ['--import', 'tsx', '--eval', consumer],
                    options
                )
            );
        } catch {
            throw new Error(
                'Synthetic category visibility SQLite fixture failed.'
            );
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it.each(cases)('%s', (name) => {
        expect(results[name]).toBe(true);
    });
});
