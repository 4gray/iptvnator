import {
    applySourceDefinition,
    normalizeSourceServerUrl,
    sameSource,
    sourceFingerprint,
    sourceFromPlaylist,
    validateSource,
} from './source-definition.util';
import type { Playlist } from './playlist.interface';

const row: Playlist = {
    _id: 'a',
    title: 'Shared',
    count: 0,
    importDate: '2026-01-01',
    lastUsage: '2026-01-01',
    autoRefresh: false,
    serverUrl: 'https://panel.test',
    username: 'user',
    password: 'secret',
    favorites: ['favorite'],
    stalkerToken: 'session',
    recentlyViewed: [],
    serverTimezone: 'Europe/Berlin',
};

describe('portable source definitions', () => {
    it('exports parsed-only M3U documents written by existing clients without losing channels', () => {
        const parsed = {
            ...row,
            serverUrl: undefined,
            username: undefined,
            password: undefined,
            playlist: {
                header: { raw: '#EXTM3U' },
                items: [
                    {
                        name: 'TV upload',
                        url: 'https://media.test/live',
                        group: { title: 'News' },
                        tvg: { logo: 'https://img.test/logo' },
                    },
                ],
            },
        };
        expect(sourceFromPlaylist(parsed).rawM3u).toBe(
            '#EXTM3U\n#EXTINF:-1 tvg-logo="https://img.test/logo" group-title="News",TV upload\nhttps://media.test/live'
        );
    });
    it('exports connection fields while excluding session and user data', () => {
        const source = sourceFromPlaylist(row);
        expect(source).toEqual({
            id: 'a',
            title: 'Shared',
            kind: 'xtream',
            serverUrl: row.serverUrl,
            username: 'user',
            password: 'secret',
        });
        expect(validateSource(source)).toEqual(source);
        expect(() => validateSource({ ...source, favorites: [] })).toThrow();
        expect(() =>
            validateSource({ ...source, stalkerToken: 'session' })
        ).toThrow();
    });
    it('merges source changes without replacing local activity', () => {
        const source = {
            ...sourceFromPlaylist(row),
            title: 'New',
            password: 'new-secret',
        };
        const merged = applySourceDefinition(source, row);
        expect(merged).toMatchObject({
            title: 'New',
            password: 'new-secret',
            favorites: ['favorite'],
            stalkerToken: 'session',
        });
        expect(sameSource(source, sourceFromPlaylist(merged))).toBe(true);
    });
    it('turns file uploads into portable raw M3U and never sends the file path', () => {
        const upload: Playlist = {
            ...row,
            serverUrl: undefined,
            filePath: '/private/upload.m3u',
            username: undefined,
            password: undefined,
            playlist: {
                header: { raw: '#EXTM3U' },
                items: [{ raw: '#EXTINF:-1,One\nhttps://media.test/one' }],
            },
        };
        const source = sourceFromPlaylist(upload);
        expect(source.kind).toBe('m3u-text');
        expect(source.rawM3u).toContain('https://media.test/one');
        expect(JSON.stringify(source)).not.toContain('/private/');
        expect(applySourceDefinition(source, upload).filePath).toBeUndefined();
    });
    it('deduplicates by provider identity and preserves a reverse-proxy base path', () => {
        const source = sourceFromPlaylist(row);
        expect(sourceFingerprint(source)).toBe(
            sourceFingerprint({
                ...source,
                id: 'other',
                title: 'Other',
                password: 'changed',
            })
        );
        expect(normalizeSourceServerUrl('https://nas.test/iptvnator/')).toBe(
            'https://nas.test/iptvnator/api'
        );
        expect(
            normalizeSourceServerUrl('https://nas.test/iptvnator/api/')
        ).toBe('https://nas.test/iptvnator/api');
        expect(normalizeSourceServerUrl('/api', 'https://nas.test/app')).toBe(
            'https://nas.test/api'
        );
        expect(() => normalizeSourceServerUrl('file:///etc/passwd')).toThrow();
        expect(() =>
            normalizeSourceServerUrl('https://user:secret@nas.test')
        ).toThrow();
    });
});
