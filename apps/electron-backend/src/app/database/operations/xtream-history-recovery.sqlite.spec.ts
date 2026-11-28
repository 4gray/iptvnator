import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

it('keeps live history mutations and clears through real SQLite replay, rollback, and source deletion', () => {
    const url = (name: string) => pathToFileURL(resolve(__dirname, name)).href;
    const connection = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const historyOrder = pathToFileURL(
        resolve(
            process.cwd(),
            'libs/shared/database/src/lib/recent-history-order.ts'
        )
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const { RECENTLY_VIEWED_CHRONOLOGY } = await import(${JSON.stringify(historyOrder)});
        const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(connection)});
        const { setAppState, getAppState, deletePlaylist, deleteAllPlaylists } = await import(${JSON.stringify(url('playlist.operations.ts'))});
        const { addRecentItem, removeRecentItem, removeRecentItemsBatch, clearPlaylistRecentItems, clearRecentlyViewed, getRecentItems, getRecentlyViewed } = await import(${JSON.stringify(url('recently-viewed.operations.ts'))});
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
        sqlite.prepare('UPDATE recently_viewed SET viewed_at = ? WHERE content_id = 2').run('2026-01-01 00:00:01');
        await addRecentItem(db, 5, 'q', { viewedAt: '2026-01-01T00:00:00.200Z' });
        await addRecentItem(db, 4, 'p', { viewedAt: '2026-01-01T00:00:00.100Z' });
        await addRecentItem(db, 5, 'q', { viewedAt: '2026-01-01T00:00:00.050Z' });
        const confirmationOrder = (await getRecentlyViewed(db)).slice(0, 3)
            .map(row => [row.playlist_id, row.viewed_at]);
        sqlite.prepare('DELETE FROM recently_viewed WHERE content_id = 4').run();
        sqlite.prepare('UPDATE recently_viewed SET viewed_at = ?').run('2026-01-01 00:00:00');
        sqlite.prepare('UPDATE recently_viewed SET viewed_at = ? WHERE content_id = 3').run('now');
        sqlite.prepare('UPDATE recently_viewed SET viewed_at = ? WHERE content_id = 3').run('2026-01-01 00:00:00');
        const globalPlan = sqlite.prepare(\`EXPLAIN QUERY PLAN
            SELECT r.viewed_at, c.id, p.name FROM recently_viewed r
            JOIN content c ON c.id = r.content_id
            JOIN categories cat ON cat.id = c.category_id
            JOIN playlists p ON p.id = cat.playlist_id
            ORDER BY \${RECENTLY_VIEWED_CHRONOLOGY} DESC LIMIT 100\`).all();
        const playlistPlan = sqlite.prepare(\`EXPLAIN QUERY PLAN
            SELECT r.viewed_at, c.id FROM recently_viewed r
            JOIN content c ON c.id = r.content_id
            WHERE r.playlist_id = ?
            ORDER BY \${RECENTLY_VIEWED_CHRONOLOGY} DESC LIMIT 100\`).all('p');
        const indexedOrder = [globalPlan, playlistPlan].map(plan =>
            plan.some(row => row.detail.includes('_chronology_idx')) &&
            plan.every(row => !row.detail.includes('USE TEMP B-TREE')));
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
        db.insert(schema.playlists).values({ id: 'duplicates', name: 'Synthetic duplicates', type: 'xtream' }).run();
        db.insert(schema.categories).values([
            { id: 10, playlistId: 'duplicates', xtreamId: 110, name: 'Synthetic first category', type: 'live' },
            { id: 11, playlistId: 'duplicates', xtreamId: 111, name: 'Synthetic second category', type: 'live' },
        ]).run();
        const insertCopies = (firstId, secondId) => db.insert(schema.content).values([
            { id: firstId, categoryId: 10, xtreamId: 42, title: 'Synthetic first copy', type: 'live' },
            { id: secondId, categoryId: 11, xtreamId: 42, title: 'Synthetic second copy', type: 'live' },
        ]).run();
        insertCopies(51000, 51001);
        db.insert(schema.recentlyViewed).values([
            { contentId: 51000, playlistId: 'duplicates', viewedAt: '2026-01-01 00:00:01' },
            { contentId: 51001, playlistId: 'duplicates', viewedAt: '2026-01-01T00:00:00.200Z' },
        ]).run();
        const legacyCopy = [];
        for (const reverse of ['OFF', 'ON']) {
            sqlite.pragma('reverse_unordered_selects = ' + reverse);
            await setAppState(db, key('duplicates'), journal());
            legacyCopy.push(JSON.parse(await getAppState(db, key('duplicates'))).recentlyViewed.map(
                row => [row.liveCategoryXtreamId, row.viewedAt]
            ));
        }
        sqlite.pragma('reverse_unordered_selects = OFF');
        sqlite.prepare('DELETE FROM content WHERE id IN (51000, 51001)').run();
        insertCopies(51002, 51003);
        await restoreXtreamUserData(db, 'duplicates', [], []);
        const restoredCopy = (await getRecentItems(db, 'duplicates', true)).map(row => row.id);
        await removeRecentItem(db, 51002, 'duplicates');
        await restoreXtreamUserData(db, 'duplicates', [], []);
        const removedCopy = (await getRecentItems(db, 'duplicates', true)).length;
        db.insert(schema.categories).values({ id: 13, playlistId: 'duplicates', xtreamId: 113, name: 'Synthetic movie category', type: 'movies' }).run();
        db.insert(schema.content).values([
            { id: 51010, categoryId: 13, xtreamId: 42, title: 'Synthetic movie', type: 'movie' },
            { id: 51011, categoryId: 2, xtreamId: 42, title: 'Synthetic other source channel', type: 'live' },
        ]).run();
        await addRecentItem(db, 51010, 'duplicates');
        await addRecentItem(db, 51011, 'q');
        await addRecentItem(db, 51002, 'duplicates', { viewedAt: '2026-01-01T00:00:01.000Z' });
        await addRecentItem(db, 51003, 'duplicates', { viewedAt: '2026-01-01T00:00:02.000Z' });
        await addRecentItem(db, 51002, 'duplicates', { viewedAt: '2026-01-01T00:00:00.000Z' });
        const readCopies = async () => (await getRecentItems(db, 'duplicates', true)).filter(row => row.type === 'live');
        const latestCopy = (await readCopies()).map(row => [row.id, row.viewed_at]);
        const liveCopyJournal = JSON.parse(await getAppState(db, key('duplicates'))).recentlyViewed.filter(row => row.contentType === 'live').map(row => row.liveCategoryXtreamId);
        await removeRecentItem(db, 51002, 'duplicates');
        await restoreXtreamUserData(db, 'duplicates', [], []);
        const removedViaOldCopy = (await readCopies()).length;
        db.insert(schema.recentlyViewed).values([51002, 51003].map(contentId => ({ contentId, playlistId: 'duplicates' }))).run();
        await removeRecentItemsBatch(db, [{ contentId: 51002, playlistId: 'duplicates' }]);
        const removedLegacyCopies = (await readCopies()).length;
        const otherIdentityCopies = (await getRecentlyViewed(db)).filter(row => row.xtream_id === 42).map(row => row.id).sort((a,b) => a-b);
        await removeRecentItem(db, 51010, 'duplicates');
        await setAppState(db, key('duplicates'), '');
        db.insert(schema.categories).values({ id: 12, playlistId: 'duplicates', xtreamId: 112, name: 'Synthetic third category', type: 'live' }).run();
        const liveCopies = entries => db.insert(schema.content).values(entries.map(([id, categoryId, xtreamId]) => ({
            id, categoryId, xtreamId, title: 'Synthetic live channel', type: 'live'
        }))).run();
        liveCopies([[51004, 10, 49], [51005, 10, 50]]);
        await addRecentItem(db, 51004, 'duplicates');
        await addRecentItem(db, 51005, 'duplicates');
        await setAppState(db, key('duplicates'), journal());
        sqlite.prepare('DELETE FROM content WHERE id IN (51004, 51005)').run();
        liveCopies([[51006, 11, 49], [51007, 11, 50], [51008, 12, 50]]);
        await restoreXtreamUserData(db, 'duplicates', [], []);
        const movedCopy = (await getRecentItems(db, 'duplicates', true)).map(row => row.id);
        const movedJournal = JSON.parse(await getAppState(db, key('duplicates')));
        await deleteAllPlaylists(db);
        const allDeleted = await getAppState(db, key('q'));
        const setting = await getAppState(db, 'unrelated-setting');
        console.log(JSON.stringify({ kept, currentTimestamp, confirmationOrder, indexedOrder, returned, resolvedReplay, rejected, rollback, cleared, other, explicit, largeExplicit, lookupRejected, lookupPreserved, globalClear, deleted, qJournal: !!qJournal, legacyCopy, restoredCopy, removedCopy, latestCopy, liveCopyJournal, removedViaOldCopy, removedLegacyCopies, otherIdentityCopies, movedCopy, resolvedMoves: movedJournal.resolved.map(row => row.xtreamId), allDeleted, setting }));
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
        confirmationOrder: [
            ['p', '2026-01-01 00:00:01'],
            ['q', '2026-01-01T00:00:00.200Z'],
            ['p', '2026-01-01T00:00:00.100Z'],
        ],
        indexedOrder: [true, true],
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
        legacyCopy: [
            [[110, '2026-01-01 00:00:01']],
            [[110, '2026-01-01 00:00:01']],
        ],
        restoredCopy: [51002],
        removedCopy: 0,
        latestCopy: [[51003, '2026-01-01T00:00:02.000Z']],
        liveCopyJournal: [111],
        removedViaOldCopy: 0,
        removedLegacyCopies: 0,
        otherIdentityCopies: [51010, 51011],
        movedCopy: [51006],
        resolvedMoves: [49],
        allDeleted: null,
        setting: 'kept',
    });
});
