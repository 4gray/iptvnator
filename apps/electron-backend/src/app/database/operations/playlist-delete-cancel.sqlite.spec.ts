import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Runs a source delete on a real, fully migrated SQLite schema in Electron's
 * Node, with one category per transaction, and reports what is left.
 * `cancelAt` aborts the delete at that checkpoint call (0 = never).
 */
function runDelete(cancelAt: number) {
    const operations = pathToFileURL(
        resolve(__dirname, 'playlist.operations.ts')
    ).href;
    const connection = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(connection)});
        const { deletePlaylist, setAppState } = await import(${JSON.stringify(operations)});
        const sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        hooks.createTables(sqlite);
        hooks.runMigrations(sqlite);
        const db = drizzle(sqlite, { schema });
        sqlite.exec(\`
            INSERT INTO playlists (id, name, type) VALUES ('p', 'Source P', 'xtream'), ('q', 'Source Q', 'xtream');
            INSERT INTO categories (id, playlist_id, xtream_id, name, type) VALUES
                (1, 'p', 1, 'Unwatched A', 'movies'),
                (2, 'p', 2, 'Watched', 'movies'),
                (3, 'p', 3, 'Unwatched B', 'movies'),
                (4, 'q', 1, 'Other source', 'movies'),
                (5, 'p', 5, 'Shows', 'series');
            INSERT INTO content (id, category_id, xtream_id, title, type) VALUES
                (1, 1, 101, 'Favorite film', 'movie'),
                (2, 1, 102, 'Film two', 'movie'),
                (3, 2, 201, 'Watched film', 'movie'),
                (4, 3, 301, 'Film four', 'movie'),
                (5, 4, 101, 'Other film', 'movie'),
                (6, 5, 401, 'Show', 'series');
            INSERT INTO favorites (id, content_id, playlist_id, xtream_id, type, title) VALUES
                (1, 1, 'p', 101, 'movie', 'Favorite film'),
                (2, 5, 'q', 101, 'movie', 'Other film');
            INSERT INTO recently_viewed (content_id, playlist_id) VALUES (3, 'p'), (5, 'q');
            INSERT INTO playback_positions (playlist_id, content_xtream_id, content_type, position_seconds, duration_seconds)
            VALUES ('p', 201, 'vod', 600, 5400), ('q', 101, 'vod', 60, 5400);
            INSERT INTO app_state (key, value) VALUES
                ('xtream-import-status:p:movie', 'completed'),
                ('xtream-import-status:p:live', 'completed'),
                ('xtream-import-status:q:movie', 'completed');
        \`);
        let calls = 0;
        const phases = [];
        let cancelled = false;
        try {
            await deletePlaylist(db, 'p', {
                checkpoint: () => {
                    calls += 1;
                    if (calls === ${cancelAt}) throw new DOMException('cancelled', 'AbortError');
                },
                onProgress: (event) => { phases.push(event.phase); },
            });
        } catch (error) {
            cancelled = error?.name === 'AbortError';
        }
        const rows = (statement) => sqlite.prepare(statement).all();
        const left = (playlistId) => ({
            playlist: rows("SELECT id FROM playlists WHERE id = '" + playlistId + "'").length,
            categories: rows("SELECT id FROM categories WHERE playlist_id = '" + playlistId + "' ORDER BY id").map((row) => row.id),
            favorites: rows("SELECT content_id, xtream_id FROM favorites WHERE playlist_id = '" + playlistId + "'"),
            recent: rows("SELECT content_id FROM recently_viewed WHERE playlist_id = '" + playlistId + "'").map((row) => row.content_id),
            positions: rows("SELECT content_xtream_id, position_seconds FROM playback_positions WHERE playlist_id = '" + playlistId + "'"),
            status: rows("SELECT key, value FROM app_state WHERE key LIKE 'xtream-import-status:" + playlistId + ":%' ORDER BY key"),
        });
        const afterDelete = left('p');
        // A re-import brings the favorite's title back under a new row id;
        // completing the catalog links the surviving favorite to it again.
        let relinked = null;
        if (afterDelete.playlist) {
            sqlite.exec("INSERT OR IGNORE INTO categories (id, playlist_id, xtream_id, name, type) VALUES (1, 'p', 1, 'Unwatched A', 'movies')");
            sqlite.exec("INSERT INTO content (id, category_id, xtream_id, title, type) SELECT 20, 1, 101, 'Favorite film', 'movie' WHERE NOT EXISTS (SELECT 1 FROM content WHERE category_id = 1 AND xtream_id = 101)");
            await setAppState(db, 'xtream-import-status:p:movie', 'completed');
            relinked = rows("SELECT content_id FROM favorites WHERE playlist_id = 'p'").map((row) => row.content_id);
        }
        console.log(JSON.stringify({ cancelled, phases, p: afterDelete, q: left('q'), relinked }));
        sqlite.close();
    `;
    return JSON.parse(
        execFileSync(
            createRequire(__filename)('electron'),
            ['--import', 'tsx', '--eval', script],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    IPTVNATOR_DB_WORKER_ROWS_PER_TRANSACTION: '1',
                    TSX_TSCONFIG_PATH: resolve(
                        process.cwd(),
                        'tsconfig.base.json'
                    ),
                },
            }
        )
    );
}

const untouchedOtherSource = {
    playlist: 1,
    categories: [4],
    favorites: [{ content_id: 5, xtream_id: 101 }],
    recent: [5],
    positions: [{ content_xtream_id: 101, position_seconds: 60 }],
    status: [{ key: 'xtream-import-status:q:movie', value: 'completed' }],
};

describe('cancelling a source delete', () => {
    // With one category per transaction the checkpoints are: 1 before
    // preparing; 2/3, 4/5, 6/7, 8/9 around the four content groups; 10/11
    // around the categories; 12 before the final transaction.
    it.each([
        {
            at: 2,
            when: 'before any catalog commit',
            categories: [1, 2, 3, 5],
            favoriteContentId: 1,
            recent: [3],
            relinked: [1],
        },
        {
            at: 3,
            when: 'after the first content group',
            categories: [1, 2, 3, 5],
            favoriteContentId: null,
            recent: [3],
            relinked: [20],
        },
        {
            at: 12,
            when: 'after the categories, at the last checkpoint',
            categories: [],
            favoriteContentId: null,
            // History cascades with its content, as an interrupted import.
            recent: [],
            relinked: [20],
        },
    ])(
        'keeps favorites and progress and marks the catalog for re-import when cancelled $when',
        ({ at, categories, favoriteContentId, recent, relinked }) => {
            const result = runDelete(at);

            expect(result.cancelled).toBe(true);
            expect(result.p).toEqual({
                playlist: 1,
                categories,
                favorites: [{ content_id: favoriteContentId, xtream_id: 101 }],
                recent,
                positions: [{ content_xtream_id: 201, position_seconds: 600 }],
                // Every type with categories, including the unkeyed series
                // catalog; live has no categories and keeps its marker.
                status: [
                    { key: 'xtream-import-status:p:live', value: 'completed' },
                    { key: 'xtream-import-status:p:movie', value: 'importing' },
                    {
                        key: 'xtream-import-status:p:series',
                        value: 'importing',
                    },
                ],
            });
            expect(result.relinked).toEqual(relinked);
            expect(result.q).toEqual(untouchedOtherSource);
        }
    );

    it('still removes everything of the source when nothing cancels it', () => {
        const result = runDelete(0);

        expect(result.cancelled).toBe(false);
        expect(result.p).toEqual({
            playlist: 0,
            categories: [],
            favorites: [],
            recent: [],
            positions: [],
            status: [],
        });
        expect(result.phases).toEqual([
            'deleting-content',
            'deleting-content',
            'deleting-content',
            'deleting-content',
            'deleting-categories',
            'deleting-favorites',
            'deleting-recently-viewed',
            'deleting-playback-positions',
            'deleting-playlist',
        ]);
        expect(result.q).toEqual(untouchedOtherSource);
    });
});
