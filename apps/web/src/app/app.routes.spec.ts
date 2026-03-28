describe('app routes', () => {
    let workspaceChildren: Array<{
        data?: Record<string, unknown>;
        loadComponent?: unknown;
        path?: string;
    }> = [];

    beforeAll(async () => {
        jest.resetModules();
        jest.unstable_mockModule('@iptvnator/playlist/m3u/feature-player', () => ({
            M3uCollectionRouteComponent: class {},
            VideoPlayerComponent: class {},
            provideM3uWorkspaceRouteSession: () => [],
        }));

        const { routes } = await import('./app.routes');
        const workspaceRoute = routes.find((route) => route.path === 'workspace');
        workspaceChildren = workspaceRoute?.children ?? [];
    });

    it('routes M3U favorites and recent pages through the shared collection wrapper', async () => {
        const favoritesRoute = workspaceChildren.find(
            (route) => route.path === 'playlists/:id/favorites'
        );
        const recentRoute = workspaceChildren.find(
            (route) => route.path === 'playlists/:id/recent'
        );

        expect(favoritesRoute?.data).toEqual({
            mode: 'favorites',
            portalType: 'm3u',
        });
        expect(recentRoute?.data).toEqual({
            mode: 'recent',
            portalType: 'm3u',
        });

        expect(typeof favoritesRoute?.loadComponent).toBe('function');
        expect(typeof recentRoute?.loadComponent).toBe('function');
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
});
