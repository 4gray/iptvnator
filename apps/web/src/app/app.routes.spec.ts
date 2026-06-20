describe('app routes', () => {
    let workspaceChildren: Array<{
        canActivate?: unknown[];
        data?: Record<string, unknown>;
        loadChildren?: unknown;
        loadComponent?: unknown;
        path?: string;
        redirectTo?: unknown;
    }> = [];
    let resolveElectronOnlyGlobalSearchRoute: (
        runtime: { isElectron: boolean },
        router: { parseUrl: (url: string) => unknown }
    ) => unknown;

    beforeAll(async () => {
        jest.resetModules();
        jest.unstable_mockModule(
            '@iptvnator/playlist/m3u/feature-player',
            () => ({
                createM3uWorkspaceRoutes: () => [
                    {
                        path: '',
                        pathMatch: 'full',
                        redirectTo: 'all',
                    },
                    {
                        path: 'favorites',
                        data: {
                            mode: 'favorites',
                            portalType: 'm3u',
                            defaultScope: 'playlist',
                        },
                    },
                    {
                        path: 'recent',
                        data: {
                            mode: 'recent',
                            portalType: 'm3u',
                            defaultScope: 'playlist',
                        },
                    },
                    {
                        path: ':view',
                    },
                ],
            })
        );

        const appRoutes = await import('./app.routes');
        const { routes } = appRoutes;
        const workspaceRoute = routes.find(
            (route) => route.path === 'workspace'
        );
        workspaceChildren = workspaceRoute?.children ?? [];
        resolveElectronOnlyGlobalSearchRoute =
            appRoutes.resolveElectronOnlyGlobalSearchRoute;
    });

    it('lazy-loads M3U workspace routes through the feature boundary', async () => {
        const playlistRoute = workspaceChildren.find(
            (route) => route.path === 'playlists/:id'
        );
        const loadChildren = playlistRoute?.loadChildren as
            | (() => Promise<typeof workspaceChildren>)
            | undefined;
        const m3uRoutes = (await loadChildren?.()) ?? [];
        const defaultRoute = m3uRoutes.find((route) => route.path === '');
        const favoritesRoute = m3uRoutes.find(
            (route) => route.path === 'favorites'
        );
        const recentRoute = m3uRoutes.find((route) => route.path === 'recent');
        const playerRoute = m3uRoutes.find((route) => route.path === ':view');

        expect(defaultRoute?.redirectTo).toBe('all');
        expect(favoritesRoute?.data).toEqual({
            mode: 'favorites',
            portalType: 'm3u',
            defaultScope: 'playlist',
        });
        expect(recentRoute?.data).toEqual({
            mode: 'recent',
            portalType: 'm3u',
            defaultScope: 'playlist',
        });

        expect(playerRoute).toBeDefined();
    });

    it('adds a shared /workspace/global-recent route', async () => {
        const globalRecentRoute = workspaceChildren.find(
            (route) => route.path === 'global-recent'
        );

        expect(globalRecentRoute?.data).toEqual({
            mode: 'recent',
            defaultScope: 'all',
        });
        expect(typeof globalRecentRoute?.loadComponent).toBe('function');
    });

    it('adds a routed /workspace/search global search view', async () => {
        const globalSearchRoute = workspaceChildren.find(
            (route) => route.path === 'search'
        );

        expect(globalSearchRoute?.data).toEqual({
            isGlobalSearch: true,
        });
        expect(globalSearchRoute?.canActivate).toHaveLength(1);
        expect(typeof globalSearchRoute?.loadComponent).toBe('function');
    });

    it('redirects the Electron-only global search route in the web runtime', async () => {
        const redirectTree = { url: '/workspace/sources' };
        const parseUrl = jest.fn().mockReturnValue(redirectTree);

        const result = resolveElectronOnlyGlobalSearchRoute(
            { isElectron: false },
            { parseUrl }
        );

        expect(parseUrl).toHaveBeenCalledWith('/workspace/sources');
        expect(result).toBe(redirectTree);
    });

    it('uses a dynamic redirect for the default /workspace child route', async () => {
        const workspaceDefaultRoute = workspaceChildren.find(
            (route) => route.path === ''
        );

        expect(typeof workspaceDefaultRoute?.redirectTo).toBe('function');
    });

    it('protects the dashboard route behind a visibility guard', async () => {
        const dashboardRoute = workspaceChildren.find(
            (route) => route.path === 'dashboard'
        );

        expect(dashboardRoute?.canActivate).toHaveLength(1);
    });
});
