import * as schema from '@iptvnator/shared/database/schema';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { AppDatabase } from '../database.types';
import { globalSearch } from './content.operations';

describe('M3U global search on SQLite', () => {
    let sqlite: Database.Database;
    let db: AppDatabase;

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.exec(
            'CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, payload TEXT)'
        );
        db = drizzle(sqlite, { schema });
        const env = { ...process.env };
        delete env['IPTVNATOR_DISABLE_M3U_BROAD_PREFILTER'];
        jest.replaceProperty(process, 'env', env);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        sqlite.close();
    });

    function insertPlaylist(id: string, payload: string): void {
        sqlite
            .prepare(
                "INSERT INTO playlists VALUES (?, 'Playlist', 'm3u-text', ?)"
            )
            .run(id, payload);
    }

    it.each([false, true])(
        'finds a real channel after 5,000 URL-only matches with the fast filter disabled=%s',
        async (disabled) => {
            if (disabled) {
                process.env['IPTVNATOR_DISABLE_M3U_BROAD_PREFILTER'] = '1';
            }
            const decoyPayload = JSON.stringify({
                playlist: {
                    items: [
                        {
                            name: 'Sample Station',
                            url: 'https://streams.invalid/aurora',
                        },
                    ],
                },
            });
            sqlite.transaction(() => {
                for (let index = 0; index < 5000; index++) {
                    const id = String(index).padStart(4, '0');
                    insertPlaylist(`synthetic-${id}`, decoyPayload);
                }
                insertPlaylist(
                    'synthetic-match',
                    JSON.stringify({
                        items: [
                            {
                                name: 'Aurora',
                                url: 'https://streams.invalid/match',
                            },
                        ],
                    })
                );
            })();

            const results = await globalSearch(db, 'aurora', ['live'], false, [
                'm3u',
            ]);
            expect(results.map(({ title }) => title)).toEqual(['Aurora']);
        }
    );

    it('finds a compound channel title with the fast filter', async () => {
        insertPlaylist(
            'synthetic-compound',
            JSON.stringify({
                playlist: {
                    items: [
                        {
                            name: 'Sample Q&R HD',
                            url: 'https://streams.invalid/compound',
                        },
                    ],
                },
            })
        );

        const results = await globalSearch(db, 'Q&R HD', ['live'], false, [
            'm3u',
        ]);
        expect(results.map(({ title }) => title)).toEqual(['Sample Q&R HD']);
    });

    it('keeps the 5,000 scored-match limit when returning a page', async () => {
        const items = Array.from({ length: 5001 }, (_, index) => {
            const id = String(index).padStart(4, '0');
            return {
                id,
                name: `Aurora ${id}`,
                url: `https://streams.invalid/${id}`,
            };
        });
        insertPlaylist('synthetic-many', JSON.stringify({ items }));

        const results = await globalSearch(
            db,
            'aurora',
            ['live'],
            false,
            ['m3u'],
            { offset: 4999, limit: 2 }
        );

        expect(results.map(({ title }) => title)).toEqual(['Aurora 4999']);
    });
});
