import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    getAppPlaylistFavoriteChannels,
    getAppPlaylistMetas,
    getPlaylist,
    parseAppPlaylist,
} from './playlist.operations';
import type { AppDatabase } from '../database.types';

function createPlaylistFavoriteChannelsDbMock(row: unknown | null) {
    const limit = jest.fn().mockResolvedValue(row ? [row] : []);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });

    return {
        db: {
            select,
        } as unknown as AppDatabase,
        from,
        limit,
        select,
        where,
    };
}

/**
 * Runs `updatePlaylist` against Electron's native SQLite on the real
 * `playlists` table (create + column migrations), the way the database
 * worker executes it; the scenario prints one JSON document.
 */
function runPlaylistUpdateScenario(scenario: string): unknown {
    const operationsUrl = pathToFileURL(
        resolve(__dirname, 'playlist.operations.ts')
    ).href;
    const connectionUrl = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const { updatePlaylist, setPlaylistServerTimezone } = await import(${JSON.stringify(operationsUrl)});
        const { __databaseConnectionTestHooks } = await import(${JSON.stringify(connectionUrl)});
        const sqlite = new Database(':memory:');
        const statements = [
            ...__databaseConnectionTestHooks.createTableStatements,
            ...__databaseConnectionTestHooks.columnMigrationStatements,
        ].filter((statement) => /TABLE IF NOT EXISTS playlists\\b|ALTER TABLE playlists\\b/.test(statement));
        for (const statement of statements) {
            try { sqlite.exec(statement); } catch { /* column already in the base table */ }
        }
        const db = drizzle(sqlite, { schema });
        ${scenario}
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
                    TSX_TSCONFIG_PATH: resolve(
                        process.cwd(),
                        'tsconfig.base.json'
                    ),
                },
            }
        )
    );
}

describe('playlist.operations', () => {
    it('hydrates updateDate from lastUpdated when payload is stale', async () => {
        const parsed = parseAppPlaylist({
            id: 'playlist-1',
            name: 'Refresh Xtream Source',
            serverUrl: 'http://localhost:8080',
            username: 'demo',
            password: 'secret',
            dateCreated: '2026-04-03T08:00:00.000Z',
            lastUpdated: '2026-04-03T11:15:00.000Z',
            type: 'xtream',
            autoRefresh: false,
            count: 0,
            importDate: '2026-04-03T08:00:00.000Z',
            payload: JSON.stringify({
                _id: 'playlist-1',
                title: 'Refresh Xtream Source',
                count: 0,
                importDate: '2026-04-03T08:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'http://localhost:8080',
                username: 'demo',
                password: 'secret',
            }),
        } as any);

        expect(parsed).toEqual(
            expect.objectContaining({
                _id: 'playlist-1',
                updateDate: new Date('2026-04-03T11:15:00.000Z').getTime(),
            })
        );
    });

    it('projects the persisted server timezone from the payload onto DB_GET_PLAYLIST rows', async () => {
        const row = {
            id: 'playlist-1',
            name: 'Xtream Source',
            serverUrl: 'http://localhost:8080',
            username: 'demo',
            password: 'secret',
            type: 'xtream',
            payload: JSON.stringify({
                _id: 'playlist-1',
                title: 'Xtream Source',
                serverTimezone: 'Europe/London',
            }),
        };
        const { db } = createPlaylistFavoriteChannelsDbMock(row);

        await expect(getPlaylist(db, 'playlist-1')).resolves.toEqual({
            ...row,
            serverTimezone: 'Europe/London',
        });
    });

    it('returns DB_GET_PLAYLIST rows untouched when the payload carries no server timezone', async () => {
        const row = {
            id: 'playlist-1',
            name: 'Xtream Source',
            type: 'xtream',
            payload: JSON.stringify({ _id: 'playlist-1', serverTimezone: ' ' }),
        };
        const { db } = createPlaylistFavoriteChannelsDbMock(row);

        await expect(getPlaylist(db, 'playlist-1')).resolves.toBe(row);
        await expect(
            getPlaylist(createPlaylistFavoriteChannelsDbMock(null).db, 'gone')
        ).resolves.toBeNull();
    });

    it('drops the persisted server timezone atomically when DB_UPDATE_PLAYLIST moves the source to another server', () => {
        // Runs the real UPDATE against Electron's SQLite: the invalidation is
        // one CASE/json_remove expression inside the statement, never a
        // read-modify-write that could hand a concurrent upsert's newer
        // payload back to the past.
        const rows = runPlaylistUpdateScenario(`
            const seed = (id, serverUrl, payload) => sqlite.prepare(
                'INSERT INTO playlists (id, name, serverUrl, type, payload) VALUES (?, ?, ?, ?, ?)'
            ).run(id, id, serverUrl, 'xtream', payload);
            seed('moved', 'http://old.example', JSON.stringify({ _id: 'moved', serverTimezone: 'Europe/London', favorites: ['1'] }));
            seed('renamed', 'http://old.example', JSON.stringify({ _id: 'renamed', serverTimezone: 'Europe/London' }));
            seed('no-clock', 'http://old.example', JSON.stringify({ _id: 'no-clock' }));
            seed('broken', 'http://old.example', 'not json');
            seed('null-url', null, JSON.stringify({ _id: 'null-url', serverTimezone: 'UTC' }));
            seed('untouched', 'http://old.example', JSON.stringify({ _id: 'untouched', serverTimezone: 'UTC' }));
            await updatePlaylist(db, 'moved', { name: 'Moved', serverUrl: 'http://new.example' });
            await updatePlaylist(db, 'renamed', { name: 'Renamed', serverUrl: 'http://old.example' });
            await updatePlaylist(db, 'no-clock', { serverUrl: 'http://new.example' });
            await updatePlaylist(db, 'broken', { serverUrl: 'http://new.example' });
            await updatePlaylist(db, 'null-url', { serverUrl: 'http://new.example' });
            await updatePlaylist(db, 'untouched', { name: 'Only renamed' });
            const rows = Object.fromEntries(
                sqlite.prepare('SELECT id, name, serverUrl, payload FROM playlists').all().map((row) => [row.id, row])
            );
            process.stdout.write(JSON.stringify(rows));
        `);

        expect(rows).toEqual({
            moved: {
                id: 'moved',
                name: 'Moved',
                serverUrl: 'http://new.example',
                payload: JSON.stringify({ _id: 'moved', favorites: ['1'] }),
            },
            renamed: {
                id: 'renamed',
                name: 'Renamed',
                serverUrl: 'http://old.example',
                payload: JSON.stringify({
                    _id: 'renamed',
                    serverTimezone: 'Europe/London',
                }),
            },
            'no-clock': {
                id: 'no-clock',
                name: 'no-clock',
                serverUrl: 'http://new.example',
                payload: JSON.stringify({ _id: 'no-clock' }),
            },
            broken: {
                id: 'broken',
                name: 'broken',
                serverUrl: 'http://new.example',
                payload: 'not json',
            },
            'null-url': {
                id: 'null-url',
                name: 'null-url',
                serverUrl: 'http://new.example',
                payload: JSON.stringify({ _id: 'null-url' }),
            },
            untouched: {
                id: 'untouched',
                name: 'Only renamed',
                serverUrl: 'http://old.example',
                payload: JSON.stringify({
                    _id: 'untouched',
                    serverTimezone: 'UTC',
                }),
            },
        });
    });

    it('records the learned panel timezone with one conditional UPDATE guarded by the row connection (issue #1562)', () => {
        const result = runPlaylistUpdateScenario(`
            const conn = { serverUrl: 'http://panel.example', username: 'u', password: 'p' };
            const seed = (id, serverUrl, payload) => sqlite.prepare(
                'INSERT INTO playlists (id, name, serverUrl, username, password, type, payload) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).run(id, id, serverUrl, 'u', 'p', 'xtream', payload);
            seed('fresh', conn.serverUrl, JSON.stringify({ _id: 'fresh', favorites: ['1'] }));
            seed('same', conn.serverUrl, JSON.stringify({ _id: 'same', serverTimezone: 'Europe/London' }));
            seed('moved', 'http://other.example', JSON.stringify({ _id: 'moved' }));
            seed('legacy', conn.serverUrl, null);
            seed('broken', conn.serverUrl, 'not json');
            const results = {
                fresh: await setPlaylistServerTimezone(db, 'fresh', conn, 'Europe/London'),
                same: await setPlaylistServerTimezone(db, 'same', conn, 'Europe/London'),
                moved: await setPlaylistServerTimezone(db, 'moved', conn, 'Europe/London'),
                legacy: await setPlaylistServerTimezone(db, 'legacy', conn, 'UTC+03:00'),
                broken: await setPlaylistServerTimezone(db, 'broken', conn, 'Europe/London'),
                missing: await setPlaylistServerTimezone(db, 'missing', conn, 'Europe/London'),
            };
            const rows = Object.fromEntries(
                sqlite.prepare('SELECT id, payload FROM playlists').all().map((row) => [row.id, row.payload])
            );
            process.stdout.write(JSON.stringify({ results, rows }));
        `) as {
            results: Record<string, { updated: boolean }>;
            rows: Record<string, string | null>;
        };

        expect(result.results).toEqual({
            fresh: { updated: true },
            same: { updated: false },
            moved: { updated: false },
            legacy: { updated: true },
            broken: { updated: false },
            missing: { updated: false },
        });
        expect(result.rows).toEqual({
            fresh: JSON.stringify({
                _id: 'fresh',
                favorites: ['1'],
                serverTimezone: 'Europe/London',
            }),
            same: JSON.stringify({
                _id: 'same',
                serverTimezone: 'Europe/London',
            }),
            moved: JSON.stringify({ _id: 'moved' }),
            legacy: JSON.stringify({ serverTimezone: 'UTC+03:00' }),
            broken: 'not json',
        });
    });

    it('loads app playlist metadata without selecting the large payload column', async () => {
        const from = jest.fn().mockResolvedValue([
            {
                id: 'playlist-meta',
                name: 'Metadata Playlist',
                type: 'm3u-url',
                dateCreated: '2026-04-01T00:00:00.000Z',
                lastUpdated: null,
                count: 2,
                importDate: '2026-04-01T00:00:00.000Z',
                favorites: JSON.stringify(['channel-1']),
                recentlyViewed: JSON.stringify([{ id: 'recent-1' }]),
                epgUrls: JSON.stringify(['https://example.com/enabled.xml']),
                detectedEpgUrls: JSON.stringify([
                    'https://example.com/enabled.xml',
                    'https://example.com/detected-only.xml',
                ]),
                manualEpgUrls: JSON.stringify([
                    'https://example.com/manual.xml',
                ]),
                disabledEpgUrls: JSON.stringify([
                    'https://example.com/disabled.xml',
                ]),
                autoRefresh: false,
                url: 'https://example.com/list.m3u',
            },
        ]);
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await expect(getAppPlaylistMetas(db)).resolves.toEqual([
            expect.objectContaining({
                _id: 'playlist-meta',
                title: 'Metadata Playlist',
                count: 2,
                favorites: ['channel-1'],
                recentlyViewed: [{ id: 'recent-1' }],
                epgUrls: ['https://example.com/enabled.xml'],
                detectedEpgUrls: [
                    'https://example.com/enabled.xml',
                    'https://example.com/detected-only.xml',
                ],
                manualEpgUrls: ['https://example.com/manual.xml'],
                disabledEpgUrls: ['https://example.com/disabled.xml'],
                url: 'https://example.com/list.m3u',
            }),
        ]);
        expect(select).toHaveBeenCalledWith(
            expect.not.objectContaining({
                payload: expect.anything(),
            })
        );
    });

    it('resolves M3U favorite channels in the worker without returning the full playlist payload', async () => {
        const firstChannel = {
            id: 'channel-1',
            name: 'Channel One',
            url: 'https://example.com/stream-1.m3u8',
            tvg: {
                id: 'tvg-1',
                name: 'Channel One',
                logo: 'https://example.com/logo-1.png',
            },
        };
        const secondChannel = {
            id: 'channel-2',
            name: 'Channel Two',
            url: 'https://example.com/stream-2.m3u8',
            tvg: {
                id: 'tvg-2',
                name: 'Channel Two',
                logo: 'https://example.com/logo-2.png',
            },
        };
        const { db } = createPlaylistFavoriteChannelsDbMock({
            id: 'playlist-1',
            favorites: JSON.stringify([
                'https://example.com/stream-2.m3u8',
                'channel-1',
                'missing-channel',
            ]),
            payload: JSON.stringify({
                playlist: {
                    items: [firstChannel, secondChannel],
                },
            }),
        });

        await expect(
            getAppPlaylistFavoriteChannels(db, 'playlist-1')
        ).resolves.toEqual([
            {
                favoriteId: 'https://example.com/stream-2.m3u8',
                favoriteIndex: 0,
                channel: secondChannel,
            },
            {
                favoriteId: 'channel-1',
                favoriteIndex: 1,
                channel: firstChannel,
            },
        ]);
    });
});
