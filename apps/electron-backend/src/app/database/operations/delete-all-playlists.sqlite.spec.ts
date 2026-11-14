import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

it('removes every source but keeps the downloads library and its finalization proofs', () => {
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
        const { deleteAllPlaylists } = await import(${JSON.stringify(operations)});
        const sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        hooks.createTables(sqlite);
        hooks.runMigrations(sqlite);
        const db = drizzle(sqlite, { schema });
        sqlite.exec(\`
            INSERT INTO playlists (id, name, type) VALUES ('p', 'Source P', 'xtream');
            INSERT INTO categories (id, playlist_id, xtream_id, name, type) VALUES (1, 'p', 1, 'Movies', 'movies');
            INSERT INTO content (id, category_id, xtream_id, title, type) VALUES (1, 1, 10, 'Film', 'movie');
            INSERT INTO downloads (id, playlist_id, xtream_id, content_type, title, url, file_path, status)
            VALUES
                (1, 'p', 10, 'vod', 'Film', 'http://localhost/movie/10.mp4', '/downloads/Film.mp4', 'completed'),
                (2, 'p', 11, 'vod', 'Paused film', 'http://localhost/movie/11.mp4', '/downloads/Paused film.mp4', 'paused');
            INSERT INTO downloads (id, playlist_id, xtream_id, content_type, programme_start, title, url, file_path, status)
            VALUES (3, 'p', 12, 'catchup', 1700000000, 'Programme', 'http://localhost/timeshift/12.ts', '/downloads/Programme.ts', 'completed');
            INSERT INTO download_archive_finalizations (download_id, proof) VALUES (3, 'synthetic-proof');
        \`);
        const progress = [];
        await deleteAllPlaylists(db, {
            checkpoint: async () => undefined,
            onProgress: async (event) => { progress.push(event); },
        });
        const count = (table) => sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
        console.log(JSON.stringify({
            playlists: count('playlists'),
            categories: count('categories'),
            content: count('content'),
            downloads: sqlite.prepare('SELECT id, status, file_path FROM downloads ORDER BY id').all(),
            finalizations: count('download_archive_finalizations'),
            phases: progress.map((event) => event.phase),
            last: progress.at(-1),
        }));
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
        playlists: 0,
        categories: 0,
        content: 0,
        downloads: [
            { id: 1, status: 'completed', file_path: '/downloads/Film.mp4' },
            {
                id: 2,
                status: 'paused',
                file_path: '/downloads/Paused film.mp4',
            },
            {
                id: 3,
                status: 'completed',
                file_path: '/downloads/Programme.ts',
            },
        ],
        finalizations: 1,
        phases: [
            'deleting-favorites',
            'deleting-recently-viewed',
            'deleting-playback-positions',
            'deleting-content',
            'deleting-categories',
            'deleting-playlists',
        ],
        last: {
            phase: 'deleting-playlists',
            current: 6,
            total: 6,
            increment: 1,
        },
    });
});
