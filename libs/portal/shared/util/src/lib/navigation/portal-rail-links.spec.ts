import { buildPortalRailLinks } from './portal-rail-links';

describe('buildPortalRailLinks', () => {
    it('builds Xtream links with scoped tooltip labels when downloads are supported', () => {
        const links = buildPortalRailLinks({
            provider: 'xtreams',
            playlistId: 'xtream-1',
            supportsDownloads: true,
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
            'downloads',
        ]);

        expect(links.primary[0]?.tooltip).toBe('Movies (this playlist)');
        expect(links.secondary[2]?.tooltip).toBe('Downloads (this playlist)');
    });

    it('builds workspace Xtream content links on web without downloads', () => {
        const links = buildPortalRailLinks({
            provider: 'xtreams',
            playlistId: 'xtream-web',
            supportsDownloads: false,
            workspace: true,
        });

        expect(links.primary.map((link) => link.section)).toEqual([
            'vod',
            'live',
            'series',
        ]);
        expect(links.secondary.map((link) => link.section)).toEqual([
            'recently-added',
            'search',
        ]);
        expect(
            links.secondary.some((link) => link.section === 'downloads')
        ).toBe(false);
    });

    it('builds workspace Stalker links with scoped tooltip labels on web', () => {
        const links = buildPortalRailLinks({
            provider: 'stalker',
            playlistId: 'portal-1',
            supportsDownloads: false,
            workspace: true,
        });

        expect(links.primary.map((link) => link.section)).toEqual([
            'vod',
            'itv',
            'radio',
            'series',
        ]);
        expect(links.secondary.map((link) => link.section)).toEqual(['search']);

        expect(links.primary[1]?.tooltip).toBe('Live TV (this playlist)');
        expect(links.primary[2]?.tooltip).toBe('Radio (this playlist)');
        expect(links.secondary[0]?.tooltip).toBe('Search (this playlist)');
        expect(
            links.secondary.some((link) => link.section === 'downloads')
        ).toBe(false);
    });

    it('builds M3U playlist links with scoped tooltip labels', () => {
        const links = buildPortalRailLinks({
            provider: 'playlists',
            playlistId: 'm3u-1',
            supportsDownloads: true,
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
        ]);
        expect(links.secondary).toEqual([]);
    });
    it.each([
        {
            sections: { movies: true, series: true },
            expected: ['all', 'groups', 'vod', 'series'],
        },
        {
            sections: { movies: true, series: false },
            expected: ['all', 'groups', 'vod'],
        },
        {
            sections: { movies: false, series: true },
            expected: ['all', 'groups', 'series'],
        },
        {
            sections: { movies: false, series: false },
            expected: ['all', 'groups'],
        },
    ])(
        'offers only the M3U catalog sections the playlist has rows for ($sections.movies/$sections.series)',
        ({ sections, expected }) => {
            // A playlist with films but no series is ordinary. Offering both
            // links would put a permanently empty section in the rail.
            const links = buildPortalRailLinks({
                provider: 'playlists',
                playlistId: 'm3u-1',
                supportsDownloads: true,
                workspace: true,
                m3uCatalogSections: sections,
            });

            expect(links.primary.map((link) => link.section)).toEqual(expected);
        }
    );

    it('keeps the M3U catalog links on the portals own section tokens', () => {
        // `vod` and `series` are the tokens the rail tooltips, the search
        // mode and the section memory already understand; a new vocabulary
        // would have to be taught to all three.
        const links = buildPortalRailLinks({
            provider: 'playlists',
            playlistId: 'm3u-1',
            supportsDownloads: true,
            workspace: true,
            m3uCatalogSections: { movies: true, series: true },
        });

        expect(links.primary.slice(2)).toEqual([
            {
                icon: 'movie',
                tooltip: 'Movies (this playlist)',
                path: ['/workspace', 'playlists', 'm3u-1', 'vod'],
                exact: true,
                section: 'vod',
            },
            {
                icon: 'video_library',
                tooltip: 'Series (this playlist)',
                path: ['/workspace', 'playlists', 'm3u-1', 'series'],
                exact: true,
                section: 'series',
            },
        ]);
    });
});
