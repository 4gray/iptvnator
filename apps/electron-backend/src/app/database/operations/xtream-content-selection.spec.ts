import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

it('persists empty selections, filters catalog reads, and refreshes without deleting disabled history', () => {
    const url = (name: string) => pathToFileURL(resolve(__dirname, name)).href;
    const connection = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(connection)});
        const { upsertAppPlaylist, updatePlaylist, getPlaylist, getAppPlaylistMetas } = await import(${JSON.stringify(url('playlist.operations.ts'))});
        const { getContent, searchContent } = await import(${JSON.stringify(url('content.operations.ts'))});
        const { deleteXtreamContent } = await import(${JSON.stringify(url('xtream.operations.ts'))});
        const sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        for (const statement of [...hooks.createTableStatements, ...hooks.columnMigrationStatements]) {
            try { sqlite.exec(statement); } catch (error) { if (!String(error).includes('duplicate column name')) throw error; }
        }
        const db = drizzle(sqlite, { schema });
        const source = { _id: 'p', title: 'Synthetic source', serverUrl: 'https://example.invalid', username: 'synthetic', password: 'synthetic', autoRefresh: true, updateDate: 100, xtreamContentTypes: ['live'] };
        const condition = { playlistId: 'p', serverUrl: source.serverUrl, username: source.username, password: source.password, previousUpdateDate: 100 };
        await upsertAppPlaylist(db, source);
        sqlite.exec("INSERT INTO app_state (key, value) VALUES ('xtream-import-status:p:live', 'completed')");
        db.insert(schema.categories).values([
            { id: 1, playlistId: 'p', xtreamId: 1, name: 'Live', type: 'live' },
            { id: 2, playlistId: 'p', xtreamId: 2, name: 'Movies', type: 'movies' },
        ]).run();
        db.insert(schema.content).values([
            { id: 1, categoryId: 1, xtreamId: 10, title: 'Test Live', type: 'live' },
            { id: 2, categoryId: 2, xtreamId: 20, title: 'Test Movie', type: 'movie' },
        ]).run();
        db.insert(schema.recentlyViewed).values([
            { contentId: 1, playlistId: 'p' }, { contentId: 2, playlistId: 'p' },
        ]).run();
        db.insert(schema.favorites).values({ contentId: 2, playlistId: 'p', xtreamId: 20, title: 'Test Movie', type: 'movie' }).run();
        const hidden = await getContent(db, 'p', 'movie');
        const search = await searchContent(db, 'p', 'Test', ['live', 'movie']);
        const skips = [];
        for (const edit of [{ autoRefresh: false }, { xtreamContentTypes: [] }, { updateDate: 1000 }, { serverUrl: 'https://other.example.invalid' }]) {
            await upsertAppPlaylist(db, { ...source, ...edit });
            const skipped = await deleteXtreamContent(db, 'p', undefined, undefined, ['live'], condition);
            skips.push({
                skipped: skipped.skipped,
                count: sqlite.prepare('SELECT count(*) AS n FROM content').get().n,
                status: sqlite.prepare("SELECT value FROM app_state WHERE key = 'xtream-import-status:p:live'").get().value
            });
        }
        await upsertAppPlaylist(db, source);
        const saved = await deleteXtreamContent(db, 'p', undefined, undefined, ['live'], condition);
        const retainedContent = sqlite.prepare('SELECT id FROM content').all();
        const retainedRecent = sqlite.prepare('SELECT content_id FROM recently_viewed').all();
        const retainedFavorite = sqlite.prepare('SELECT content_id FROM favorites').all();
        await updatePlaylist(db, 'p', { xtreamContentTypes: [] });
        const row = await getPlaylist(db, 'p');
        const metas = await getAppPlaylistMetas(db);
        const noOp = await deleteXtreamContent(db, 'p', undefined, undefined, []);
        console.log(JSON.stringify({ skips, hidden, search: search.map(row => row.type), savedRecent: saved.recentlyViewed.map(row => row.contentType).sort(), retainedContent, retainedRecent, retainedFavorite, selection: row.xtreamContentTypes, metaSelection: metas[0].xtreamContentTypes, noOpRecent: noOp.recentlyViewed.length, remaining: sqlite.prepare('SELECT count(*) AS n FROM content').get().n }));
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
        skips: Array(4).fill({ skipped: true, count: 2, status: 'completed' }),
        hidden: [],
        search: ['live'],
        savedRecent: ['live', 'movie'],
        retainedContent: [{ id: 2 }],
        retainedRecent: [{ content_id: 2 }],
        retainedFavorite: [{ content_id: 2 }],
        selection: [],
        metaSelection: [],
        noOpRecent: 1,
        remaining: 1,
    });
});
