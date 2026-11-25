import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

it.each([false, true])(
    'finds a real M3U match after 5,000 URL-only playlist matches with the fast filter disabled=%s',
    (disabled) => {
        const operationsUrl = pathToFileURL(
            resolve(
                process.cwd(),
                'apps/electron-backend/src/app/database/operations/content.operations.ts'
            )
        ).href;
        const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const { globalSearch } = await import(${JSON.stringify(operationsUrl)});

        const sqlite = new Database(':memory:');
        sqlite.exec('CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, payload TEXT)');
        const insert = sqlite.prepare("INSERT INTO playlists VALUES (?, 'Playlist', 'm3u-text', ?)");
        const decoyPayload = JSON.stringify({
            playlist: { items: [{ name: 'Sample Station', url: 'https://streams.invalid/aurora' }] },
        });
        sqlite.transaction(() => {
            for (let index = 0; index < 5000; index++) {
                insert.run('synthetic-' + String(index).padStart(4, '0'), decoyPayload);
            }
            insert.run('synthetic-match', JSON.stringify({
                items: [{ name: 'Aurora', url: 'https://streams.invalid/match' }],
            }));
        })();

        try {
            const results = await globalSearch(drizzle(sqlite), 'aurora', ['live'], false, ['m3u']);
            console.log(JSON.stringify(results.map(({ title }) => title)));
        } finally {
            sqlite.close();
        }
    `;
        const output = execFileSync(
            createRequire(__filename)('electron'),
            ['--import', 'tsx', '--eval', script],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    IPTVNATOR_DISABLE_M3U_BROAD_PREFILTER: disabled ? '1' : '0',
                    TSX_TSCONFIG_PATH: resolve(
                        process.cwd(),
                        'tsconfig.base.json'
                    ),
                },
            }
        );
        expect(JSON.parse(output)).toEqual(['Aurora']);
    }
);
