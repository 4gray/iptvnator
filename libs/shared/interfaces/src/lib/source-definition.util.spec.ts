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
    it.each(['nested', 'top-level', 'empty-nested'] as const)(
        'retains uploaded channels and header EPG URLs from %s parsed documents',
        (shape) => {
            const parsed = {
                header: {
                    raw: '#EXTM3U x-tvg-url="https://guide.test/epg.xml"',
                },
                items: [
                    {
                        raw: '#EXTINF:-1,Raw channel',
                        url: 'https://media.test/raw',
                    },
                    {
                        name: 'Parsed channel',
                        url: 'https://media.test/parsed',
                    },
                ],
            };
            const upload: Playlist = {
                ...row,
                serverUrl: undefined,
                username: undefined,
                password: undefined,
                ...(shape === 'nested'
                    ? { playlist: parsed }
                    : {
                          ...parsed,
                          ...(shape === 'empty-nested' ? { playlist: {} } : {}),
                      }),
            };
            const saved = structuredClone(upload);
            const expected =
                '#EXTM3U x-tvg-url="https://guide.test/epg.xml"\n#EXTINF:-1,Raw channel\nhttps://media.test/raw\n#EXTINF:-1,Parsed channel\nhttps://media.test/parsed';
            expect(sourceFromPlaylist(upload).rawM3u).toBe(expected);
            expect(
                sourceFromPlaylist({
                    ...upload,
                    sourceRawM3u:
                        '#EXTM3U\n#EXTINF:-1,Canonical\nhttps://media.test/canonical',
                }).rawM3u
            ).toContain('https://media.test/canonical');
            expect(sourceFromPlaylist(upload, false).rawM3u).toBeUndefined();
            expect(upload).toEqual(saved);
        }
    );

    it('compares absent nullable optional fields consistently while keeping API input validation strict', () => {
        const source = sourceFromPlaylist(row);
        const nullable = {
            ...source,
            stalkerSerialNumber: null,
            userAgent: null,
        };
        expect(sameSource(source, nullable as never)).toBe(true);
        expect(() => validateSource(nullable)).toThrow('Invalid source field');
        expect(
            sourceFromPlaylist({ ...row, isFullStalkerPortal: false })
                .isFullStalkerPortal
        ).toBe(false);
    });
    it('compares SQLite-projected strings canonically without changing raw content or configured Stalker identity', () => {
        const source = {
            id: 'a',
            title: 'Name',
            kind: 'xtream' as const,
            serverUrl: 'https://panel.test',
            username: 'user',
            password: 'secret',
        };
        const baseline = {
            ...source,
            title: ' Name ',
            username: ' user ',
            password: ' secret ',
            userAgent: '  ',
        };
        expect(sameSource(source, baseline)).toBe(true);
        expect(baseline.password).toBe(' secret ');
        expect(sameSource(source, { ...source, password: 'sec ret' })).toBe(
            false
        );
        expect(
            sameSource(
                { ...source, stalkerDeviceId1: 'pinned' },
                { ...source, stalkerDeviceId1: ' pinned ' }
            )
        ).toBe(false);
        const raw = {
            id: 'raw',
            title: 'Raw',
            kind: 'm3u-text' as const,
            rawM3u: '#EXTM3U\n',
        };
        expect(sameSource(raw, { ...raw, rawM3u: '#EXTM3U' })).toBe(false);
    });
    it('keeps a trailing slash inside a signed query value when deduplicating sources', () => {
        const source = {
            id: 'a',
            title: 'Signed',
            kind: 'm3u-url' as const,
            url: 'https://host.test/list?token=abc/',
        };
        expect(sourceFingerprint(source)).not.toBe(
            sourceFingerprint({
                ...source,
                url: 'https://host.test/list?token=abc',
            })
        );
    });
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
    it('keeps desktop catalog choices local when shared source definitions change', () => {
        const local = { ...row, xtreamContentTypes: ['live' as const] };
        const source = sourceFromPlaylist(local);
        expect(source).not.toHaveProperty('xtreamContentTypes');
        expect(() =>
            validateSource({ ...source, xtreamContentTypes: ['movie'] })
        ).toThrow('Invalid source field');
        expect(
            applySourceDefinition({ ...source, title: 'Remote title' }, local)
                .xtreamContentTypes
        ).toEqual(['live']);
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
