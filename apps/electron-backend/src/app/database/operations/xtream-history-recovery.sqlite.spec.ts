import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

it('keeps live history mutations and clears through real SQLite replay, rollback, and source deletion', () => {
    const url = (name: string) => pathToFileURL(resolve(__dirname, name)).href;
    const connection = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(connection)});
        const { setAppState, getAppState, deletePlaylist, deleteAllPlaylists } = await import(${JSON.stringify(url('playlist.operations.ts'))});
        const { addRecentItem, removeRecentItem, removeRecentItemsBatch, clearPlaylistRecentItems, clearRecentlyViewed, getRecentItems } = await import(${JSON.stringify(url('recently-viewed.operations.ts'))});
        const { restoreXtreamUserData } = await import(${JSON.stringify(url('xtream.operations.ts'))});
        const sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        for (const statement of [...hooks.createTableStatements, ...hooks.columnMigrationStatements]) {
            try { sqlite.exec(statement); } catch (error) { if (!String(error).includes('duplicate column name')) throw error; }
        }
        const db = drizzle(sqlite, { schema });
        db.insert(schema.playlists).values([{ id: 'p', name: 'Source P', type: 'xtream' }, { id: 'q', name: 'Source Q', type: 'xtream' }]).run();
        db.insert(schema.categories).values([{ id: 1, playlistId: 'p', xtreamId: 1, name: 'P', type: 'live' }, { id: 2, playlistId: 'q', xtreamId: 1, name: 'Q', type: 'live' }]).run();
        db.insert(schema.content).values([1,2,3,4].map(id => ({ id, categoryId: 1, xtreamId: id * 10, title: 'P ' + id, type: 'live' }))).run();
        db.insert(schema.content).values({ id: 5, categoryId: 2, xtreamId: 50, title: 'Q', type: 'live' }).run();
        db.insert(schema.recentlyViewed).values([1,2,3,5].map(contentId => ({ contentId, playlistId: contentId === 5 ? 'q' : 'p', viewedAt: '2026-01-01 00:00:00' }))).run();
        const key = id => 'xtream-history-recovery:' + id;
        const journal = (recentlyViewed = []) => JSON.stringify({ version: 1, contentTypes: ['movie'], recentlyViewed });
        const stale = [{ contentType: 'live', xtreamId: 10, viewedAt: '2020-01-01' }, { contentType: 'live', xtreamId: 20, viewedAt: '2020-01-01' }];
        await setAppState(db, key('p'), journal([{ contentType: 'movie', xtreamId: 99, viewedAt: 'archive' }]));
        await setAppState(db, key('q'), journal());
        await addRecentItem(db, 1, 'p');
        await addRecentItem(db, 4, 'p');
        await removeRecentItem(db, 2, 'p');
        await removeRecentItemsBatch(db, [{ contentId: 3, playlistId: 'p' }]);
        await removeRecentItemsBatch(db, [{ contentId: 5, playlistId: 'p' }]);
        await restoreXtreamUserData(db, 'p', [], stale);
        const first = await getRecentItems(db, 'p', true);
        const kept = first.map(row => row.xtream_id).sort((a,b) => a-b);
        const currentTimestamp = first.find(row => row.xtream_id === 10).viewed_at !== '2026-01-01 00:00:00';
        db.insert(schema.categories).values({ id: 3, playlistId: 'p', xtreamId: 3, name: 'Movies', type: 'movies' }).run();
        db.insert(schema.content).values({ id: 6, categoryId: 3, xtreamId: 99, title: 'Archive Movie', type: 'movie' }).run();
        await restoreXtreamUserData(db, 'p', [], stale);
        const returned = (await getRecentItems(db, 'p', true)).map(row => row.xtream_id).sort((a,b) => a-b);
        const resolvedReplay = JSON.parse(await getAppState(db, key('p'))).resolved.map(row => row.xtreamId).sort((a,b) => a-b);
        const beforeFailure = sqlite.prepare('SELECT * FROM recently_viewed WHERE playlist_id = ? ORDER BY id').all('p');
        sqlite.exec("CREATE TRIGGER test_fail_history BEFORE INSERT ON recently_viewed WHEN NEW.content_id = 4 BEGIN SELECT RAISE(ABORT, 'test replay fault'); END");
        let rejected = false;
        try { await restoreXtreamUserData(db, 'p', [], stale); } catch { rejected = true; }
        const rollback = JSON.stringify(beforeFailure) === JSON.stringify(sqlite.prepare('SELECT * FROM recently_viewed WHERE playlist_id = ? ORDER BY id').all('p'));
        sqlite.exec('DROP TRIGGER test_fail_history');
        // More content ids than SQLite's bind-variable limit must still clear
        // only this source, while its recovery journal stays transactional.
        for (let offset = 0; offset < 40000; offset += 500)
            db.insert(schema.content).values(Array.from({ length: 500 }, (_, index) => ({
                id: 100 + offset + index, categoryId: 3, xtreamId: 100000 + offset + index,
                title: 'Large clear ' + (offset + index), type: 'movie'
            }))).run();
        await clearPlaylistRecentItems(db, 'p');
        await restoreXtreamUserData(db, 'p', [], stale);
        const cleared = (await getRecentItems(db, 'p', true)).length;
        const other = (await getRecentItems(db, 'q', true)).map(row => row.xtream_id);
        await setAppState(db, key('p'), '');
        await restoreXtreamUserData(db, 'p', [], stale.slice(0,1));
        const explicit = (await getRecentItems(db, 'p', true)).map(row => row.viewed_at);
        const largeHistory = Array.from({ length: 40000 }, (_, index) => ({
            contentType: 'movie', xtreamId: 100000 + index,
            viewedAt: '2026-02-01 00:00:00'
        }));
        await restoreXtreamUserData(db, 'p', [], largeHistory);
        const largeExplicit = (await getRecentItems(db, 'p', true)).length;
        const brokenLookup = new Proxy(db, {
            get(target, property) {
                if (property === 'select') return (...args) => {
                    if (args[0]?.xtreamId) throw new Error('synthetic lookup failure');
                    return target.select(...args);
                };
                return Reflect.get(target, property);
            }
        });
        let lookupRejected = false;
        try { await restoreXtreamUserData(brokenLookup, 'p', [], stale); } catch { lookupRejected = true; }
        const lookupPreserved = (await getRecentItems(db, 'p', true)).length === largeExplicit;
        await setAppState(db, key('p'), journal());
        await clearRecentlyViewed(db);
        await setAppState(db, key('p'), JSON.stringify({ version: 1, contentTypes: ['live'], recentlyViewed: stale }));
        await restoreXtreamUserData(db, 'p', [], stale);
        await restoreXtreamUserData(db, 'q', [], stale);
        const globalClear = (await getRecentItems(db, 'p', true)).length + (await getRecentItems(db, 'q', true)).length;
        await deletePlaylist(db, 'p');
        const deleted = await getAppState(db, key('p'));
        const qJournal = await getAppState(db, key('q'));
        await setAppState(db, 'unrelated-setting', 'kept');
        await deleteAllPlaylists(db);
        const allDeleted = await getAppState(db, key('q'));
        const setting = await getAppState(db, 'unrelated-setting');
        console.log(JSON.stringify({ kept, currentTimestamp, returned, resolvedReplay, rejected, rollback, cleared, other, explicit, largeExplicit, lookupRejected, lookupPreserved, globalClear, deleted, qJournal: !!qJournal, allDeleted, setting }));
        sqlite.close();
    `;
    const result = JSON.parse(
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
    expect(result).toEqual({
        kept: [10, 40],
        currentTimestamp: true,
        returned: [10, 40, 99],
        resolvedReplay: [10, 40, 99],
        rejected: true,
        rollback: true,
        cleared: 0,
        other: [50],
        explicit: ['2020-01-01'],
        largeExplicit: 40000,
        lookupRejected: true,
        lookupPreserved: true,
        globalClear: 0,
        deleted: null,
        qJournal: true,
        allDeleted: null,
        setting: 'kept',
    });
});
