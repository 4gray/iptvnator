import { buildPortalRailLinks } from './portal-rail-links';

describe('buildPortalRailLinks', () => {
    it('builds Xtream links with scoped tooltip labels on Electron', () => {
        const links = buildPortalRailLinks({
            provider: 'xtreams',
            playlistId: 'xtream-1',
            isElectron: true,
            workspace: false,
        });

        expect(links.primary.map((link) => link.section)).toEqual([
            'vod',
            'live',
            'series',
        ]);
        expect(links.secondary.map((link) => link.section)).toEqual([
            'recently-added',
            'search',
            'recent',
            'favorites',
            'downloads',
        ]);

        expect(links.primary[0]?.tooltip).toBe('Movies (this playlist)');
        expect(links.secondary[3]?.tooltip).toBe('Favorites (this playlist)');
        expect(links.secondary[4]?.tooltip).toBe('Downloads (this playlist)');
    });

    it('builds workspace Xtream links without downloads on web', () => {
        const links = buildPortalRailLinks({
            provider: 'xtreams',
            playlistId: 'xtream-web',
            isElectron: false,
            workspace: true,
        });

        expect(links.primary).toEqual([
            {
                icon: 'movie',
                tooltip: 'Xtream library (this playlist)',
                path: ['/workspace', 'xtreams', 'xtream-web'],
                exact: true,
                section: 'library',
            },
        ]);
        expect(links.secondary).toEqual([]);
    });

    it('builds Stalker links with scoped tooltip labels', () => {
        const links = buildPortalRailLinks({
            provider: 'stalker',
            playlistId: 'portal-1',
            isElectron: false,
            workspace: false,
        });

        expect(links.primary.map((link) => link.section)).toEqual([
            'vod',
            'itv',
            'series',
        ]);
        expect(links.secondary.map((link) => link.section)).toEqual([
            'search',
            'recent',
            'favorites',
        ]);

        expect(links.primary[1]?.tooltip).toBe('Live TV (this playlist)');
        expect(links.secondary[0]?.tooltip).toBe('Search (this playlist)');
        expect(links.secondary[2]?.tooltip).toBe('Favorites (this playlist)');
    });

    it('builds M3U playlist links with scoped tooltip labels', () => {
        const links = buildPortalRailLinks({
            provider: 'playlists',
            playlistId: 'm3u-1',
            isElectron: true,
            workspace: true,
        });

        expect(links.primary).toEqual([
            {
                icon: 'tv',
                tooltip: 'All channels (this playlist)',
                path: ['/workspace', 'playlists', 'm3u-1', 'all'],
                exact: true,
                section: 'all',
            },
            {
                icon: 'folder',
                tooltip: 'Groups (this playlist)',
                path: ['/workspace', 'playlists', 'm3u-1', 'groups'],
                exact: true,
                section: 'groups',
            },
            {
                icon: 'history',
                tooltip: 'Recently viewed (this playlist)',
                path: ['/workspace', 'playlists', 'm3u-1', 'recent'],
                exact: true,
                section: 'recent',
            },
            {
                icon: 'favorite',
                tooltip: 'Favorites (this playlist)',
                path: ['/workspace', 'playlists', 'm3u-1', 'favorites'],
                exact: true,
                section: 'favorites',
            },
        ]);
        expect(links.secondary).toEqual([]);
    });
});
