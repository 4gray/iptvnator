import { GLOBAL_FAVORITES_PLAYLIST_ID } from 'shared-interfaces';
import { buildPortalRailLinks } from './portal-rail-links';

describe('buildPortalRailLinks', () => {
    it('builds legacy Xtream links with downloads on Electron', () => {
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
        expect(links.primary[0]?.path).toEqual(['/xtreams', 'xtream-1', 'vod']);
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
                tooltip: 'Xtream library',
                path: ['/workspace', 'xtreams', 'xtream-web'],
                exact: true,
                section: 'library',
            },
        ]);
        expect(links.secondary).toEqual([]);
    });

    it('builds Stalker links with mapped itv section', () => {
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
        expect(links.primary[1]?.path).toEqual(['/stalker', 'portal-1', 'itv']);
    });

    it('builds playlist links with global favorites in workspace', () => {
        const links = buildPortalRailLinks({
            provider: 'playlists',
            playlistId: 'm3u-1',
            isElectron: true,
            workspace: true,
        });

        expect(links.primary).toEqual([
            {
                icon: 'play_circle',
                tooltip: 'Player',
                path: ['/workspace', 'playlists', 'm3u-1'],
                exact: true,
                section: 'player',
            },
        ]);

        expect(links.secondary).toEqual([
            {
                icon: 'favorite',
                tooltip: 'Global favorites',
                path: ['/workspace', 'playlists', GLOBAL_FAVORITES_PLAYLIST_ID],
                section: 'favorites',
            },
        ]);
    });
});
