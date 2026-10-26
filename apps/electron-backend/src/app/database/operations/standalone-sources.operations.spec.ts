import Database from 'better-sqlite3';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Playlist } from '@iptvnator/shared/interfaces';
import { sourceFromPlaylist } from '@iptvnator/shared/interfaces/source-definition';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import { readStandaloneSources } from './standalone-sources.operations';

jest.mock('@iptvnator/shared/database/path-utils', () => ({
    getIptvnatorDataRoot: jest.fn(),
}));

describe('read-only import from an original SQLite profile', () => {
    let directory: string;
    let filename: string;
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'iptvnator-original-sources-'));
        filename = join(directory, 'databases', 'iptvnator.db');
        (getIptvnatorDataRoot as jest.Mock).mockReturnValue(directory);
    });
    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    it('reads historical snake-case columns and portable M3U without changing the original database', () => {
        mkdirSync(join(directory, 'databases'));
        const sqlite = new Database(filename);
        sqlite.exec(
            'CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT, type TEXT, server_url TEXT, username TEXT, password TEXT, favorites TEXT, payload TEXT)'
        );
        sqlite
            .prepare('INSERT INTO playlists VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(
                'xtream',
                'Original portal',
                'xtream',
                'https://panel.test',
                'user',
                'synthetic-secret',
                '["local-favorite"]',
                null
            );
        sqlite
            .prepare('INSERT INTO playlists VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(
                'file',
                'Original file',
                'm3u-file',
                null,
                null,
                null,
                '[]',
                JSON.stringify({
                    filePath: '/another-device/list.m3u',
                    playlist: {
                        header: { raw: '#EXTM3U' },
                        items: [
                            {
                                raw: '#EXTINF:-1,Portable\nhttps://media.test/one',
                            },
                        ],
                    },
                })
            );
        sqlite.close();
        const original = readFileSync(filename);
        const rows = readStandaloneSources();
        expect(rows[0]).toMatchObject({
            _id: 'xtream',
            title: 'Original portal',
            serverUrl: 'https://panel.test',
            favorites: ['local-favorite'],
        });
        expect(
            sourceFromPlaylist(rows[0] as unknown as Playlist)
        ).not.toHaveProperty('favorites');
        expect(
            sourceFromPlaylist(rows[1] as unknown as Playlist)
        ).toMatchObject({
            kind: 'm3u-text',
            rawM3u: '#EXTM3U\n#EXTINF:-1,Portable\nhttps://media.test/one',
        });
        expect(readFileSync(filename)).toEqual(original);
    });

    it('does not create an empty database when there is no original profile', () => {
        expect(readStandaloneSources()).toEqual([]);
        expect(existsSync(filename)).toBe(false);
    });

    it('reports an unreadable original instead of importing an apparently empty library', () => {
        mkdirSync(join(directory, 'databases'));
        writeFileSync(filename, 'invalid-sqlite');
        expect(() => readStandaloneSources()).toThrow();
        expect(readFileSync(filename, 'utf8')).toBe('invalid-sqlite');
    });
});
