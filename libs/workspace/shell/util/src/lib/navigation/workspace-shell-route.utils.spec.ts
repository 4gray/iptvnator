import {
    parseWorkspaceShellRoute,
    usesWorkspaceRouteQuerySearch,
} from './workspace-shell-route.utils';

describe('workspace-shell-route.utils', () => {
    it('parses top-level workspace pages', () => {
        expect(parseWorkspaceShellRoute('/workspace')).toEqual(
            expect.objectContaining({
                kind: 'dashboard',
                context: null,
                contextPanel: 'none',
                searchMode: 'advanced-only',
                usesQuerySearch: false,
            })
        );
        expect(parseWorkspaceShellRoute('/workspace/sources?q=matrix')).toEqual(
            expect.objectContaining({
                kind: 'sources',
                context: null,
                contextPanel: 'sources',
                searchMode: 'local-filter',
                usesQuerySearch: true,
            })
        );
        expect(parseWorkspaceShellRoute('/workspace/settings')).toEqual(
            expect.objectContaining({
                kind: 'settings',
                context: null,
                contextPanel: 'settings',
            })
        );
        expect(parseWorkspaceShellRoute('/workspace/global-favorites')).toEqual(
            expect.objectContaining({
                kind: 'global-favorites',
            })
        );
        expect(parseWorkspaceShellRoute('/workspace/downloads')).toEqual(
            expect.objectContaining({
                kind: 'downloads',
            })
        );
    });

    it('parses Xtream portal routes and detects context-panel/query-search state', () => {
        expect(
            parseWorkspaceShellRoute('/workspace/xtreams/pl-1/vod/42')
        ).toEqual(
            expect.objectContaining({
                kind: 'portal',
                context: {
                    provider: 'xtreams',
                    playlistId: 'pl-1',
                },
                section: 'vod',
                contextPanel: 'category',
                searchMode: 'local-filter',
                usesQuerySearch: true,
                isPortalFavoritesAllScope: false,
            })
        );

        expect(
            parseWorkspaceShellRoute(
                '/workspace/xtreams/pl-1/favorites?scope=all&q=neo'
            )
        ).toEqual(
            expect.objectContaining({
                section: 'favorites',
                contextPanel: 'none',
                searchMode: 'local-filter',
                usesQuerySearch: true,
                isPortalFavoritesAllScope: true,
            })
        );

        expect(
            parseWorkspaceShellRoute('/workspace/xtreams/pl-1/downloads')
        ).toEqual(
            expect.objectContaining({
                section: 'downloads',
                contextPanel: 'collection',
                searchMode: 'local-filter',
                usesQuerySearch: true,
            })
        );
    });

    it('parses Stalker portal routes and detects context-panel/query-search state', () => {
        expect(
            parseWorkspaceShellRoute('/workspace/stalker/pl-2/itv')
        ).toEqual(
            expect.objectContaining({
                kind: 'portal',
                context: {
                    provider: 'stalker',
                    playlistId: 'pl-2',
                },
                section: 'itv',
                contextPanel: 'category',
                searchMode: 'remote-search',
                usesQuerySearch: true,
            })
        );

        expect(
            parseWorkspaceShellRoute('/workspace/stalker/pl-2/recent?q=test')
        ).toEqual(
            expect.objectContaining({
                section: 'recent',
                contextPanel: 'none',
                searchMode: 'local-filter',
                usesQuerySearch: true,
            })
        );
    });

    it('parses M3U portal routes without provider-specific workspace state', () => {
        expect(
            parseWorkspaceShellRoute('/workspace/playlists/pl-3/favorites')
        ).toEqual(
            expect.objectContaining({
                kind: 'portal',
                context: {
                    provider: 'playlists',
                    playlistId: 'pl-3',
                },
                section: 'favorites',
                contextPanel: 'none',
                searchMode: 'local-filter',
                usesQuerySearch: true,
                isPortalFavoritesAllScope: false,
            })
        );
    });

    it('returns unknown for non-workspace URLs', () => {
        expect(parseWorkspaceShellRoute('/xtreams/pl-1/search')).toEqual(
            expect.objectContaining({
                kind: 'unknown',
                context: null,
                section: null,
                searchMode: 'none',
            })
        );
    });

    it('exposes query-search eligibility as a pure helper', () => {
        expect(
            usesWorkspaceRouteQuerySearch(
                { provider: 'xtreams', playlistId: '1' },
                'favorites'
            )
        ).toBe(true);
        expect(
            usesWorkspaceRouteQuerySearch(
                { provider: 'xtreams', playlistId: '1' },
                'vod'
            )
        ).toBe(true);
        expect(
            usesWorkspaceRouteQuerySearch(
                { provider: 'stalker', playlistId: '1' },
                'recent'
            )
        ).toBe(true);
        expect(
            usesWorkspaceRouteQuerySearch(
                { provider: 'playlists', playlistId: '1' },
                'favorites'
            )
        ).toBe(true);
    });
});
