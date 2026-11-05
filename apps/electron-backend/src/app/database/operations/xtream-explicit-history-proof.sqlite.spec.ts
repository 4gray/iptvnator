import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const cases = [
    'restores-retained-idle-history',
    'returns-exact-typed-replay-proof',
    'excludes-missing-and-unrequested-identities',
    'replaces-old-native-history',
    'proof-survives-later-removal',
    'retains-independent-missing-history',
    'captures-journal-proof-before-progress-await',
] as const;

describe('explicit history replay proof on historical SQLite', () => {
    let result: Record<string, boolean>;

    beforeAll(() => {
        const url = (path: string) => pathToFileURL(resolve(path)).href;
        const script = `
            const { default: Database } = await import('better-sqlite3');
            const { drizzle } = await import('drizzle-orm/better-sqlite3');
            const schema = await import('@iptvnator/shared/database/schema');
            const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(url('libs/shared/database/src/lib/connection.ts'))});
            const { restoreXtreamUserData } = await import(${JSON.stringify(url(resolve(__dirname, 'xtream.operations.ts')))});
            const { getRecentItems, addRecentItem, removeRecentItem } = await import(${JSON.stringify(url(resolve(__dirname, 'recently-viewed.operations.ts')))});
            const { setAppState } = await import(${JSON.stringify(url(resolve(__dirname, 'playlist.operations.ts')))});
            const sqlite = new Database(':memory:');
            sqlite.pragma('foreign_keys = ON');
            for (const statement of [...hooks.createTableStatements, ...hooks.columnMigrationStatements]) {
                try { sqlite.exec(statement); } catch (error) {
                    if (!String(error).includes('duplicate column name')) throw error;
                }
            }
            const db = drizzle(sqlite, { schema });
            const playlistId = 'synthetic-source';
            db.insert(schema.playlists).values({ id: playlistId, name: 'Synthetic source', type: 'xtream' }).run();
            db.insert(schema.categories).values([
                { id: 1, playlistId, xtreamId: 91, name: 'Synthetic Live category', type: 'live' },
                { id: 2, playlistId, xtreamId: 92, name: 'Synthetic Movie category', type: 'movies' }
            ]).run();
            db.insert(schema.content).values([
                { id: 1, categoryId: 1, xtreamId: 881101, title: 'Synthetic retained Live item', type: 'live' },
                { id: 2, categoryId: 2, xtreamId: 881103, title: 'Synthetic enabled Movie item', type: 'movie' },
                { id: 3, categoryId: 1, xtreamId: 881104, title: 'Synthetic previous history item', type: 'live' },
                { id: 4, categoryId: 2, xtreamId: 881101, title: 'Synthetic colliding Movie item', type: 'movie' }
            ]).run();
            const liveStatus = 'xtream-import-status:' + playlistId + ':live';
            await setAppState(db, liveStatus, 'idle');
            await setAppState(db, 'xtream-import-status:' + playlistId + ':movie', 'completed');
            await addRecentItem(db, 3, playlistId);
            const archive = [
                { contentType: 'live', xtreamId: 881101, viewedAt: '2026-01-01 00:00:00' },
                { contentType: 'live', xtreamId: 881102, viewedAt: '2026-01-02 00:00:00' },
                { contentType: 'movie', xtreamId: 881103, viewedAt: '2026-01-03 00:00:00' }
            ];
            const restored = await restoreXtreamUserData(db, playlistId, [], archive);
            const history = await getRecentItems(db, playlistId, true);
            const keys = rows => (rows ?? []).map(row => row.contentType + ':' + row.xtreamId).sort();
            const expected = ['live:881101', 'movie:881103'];
            const proof = keys(restored.resolvedHistory);
            const result = {
                'restores-retained-idle-history': history.some(row => row.type === 'live' && row.xtream_id === 881101),
                'returns-exact-typed-replay-proof': JSON.stringify(proof) === JSON.stringify(expected),
                'excludes-missing-and-unrequested-identities': Array.isArray(restored.resolvedHistory) && !proof.includes('live:881102') && !proof.includes('movie:881101'),
                'replaces-old-native-history': !history.some(row => row.xtream_id === 881104)
            };
            await addRecentItem(db, 1, playlistId);
            await removeRecentItem(db, 1, playlistId);
            const remainingArchive = archive.filter(row => !new Set(proof).has(row.contentType + ':' + row.xtreamId));
            result['proof-survives-later-removal'] = Array.isArray(restored.resolvedHistory) && !remainingArchive.some(row => row.xtreamId === 881101) && !(await getRecentItems(db, playlistId, true)).some(row => row.xtream_id === 881101);
            result['retains-independent-missing-history'] = remainingArchive.some(row => row.xtreamId === 881102);
            const journalKey = 'xtream-history-recovery:' + playlistId;
            await setAppState(db, journalKey, JSON.stringify({ version: 1, contentTypes: ['live', 'movie'], recentlyViewed: archive }));
            const journalRestored = await restoreXtreamUserData(db, playlistId, [], [], {
                onProgress: async progress => {
                    if (progress.phase === 'restoring-recently-viewed') {
                        await removeRecentItem(db, 1, playlistId);
                        await setAppState(db, journalKey, '');
                    }
                }
            });
            result['captures-journal-proof-before-progress-await'] = JSON.stringify(keys(journalRestored.resolvedHistory)) === JSON.stringify(expected);
            sqlite.close();
            console.log(JSON.stringify(result));
        `;
        try {
            result = JSON.parse(
                execFileSync(
                    createRequire(__filename)('electron'),
                    ['--import', 'tsx', '--eval', script],
                    {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        stdio: 'pipe',
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
        } catch {
            throw new Error(
                'Synthetic explicit history SQLite fixture failed.'
            );
        }
    });

    it.each(cases)('%s', (name) => {
        expect(result[name]).toBe(true);
    });
});
