import { Route, Routes } from '@angular/router';

function withWorkspaceLayout(routes: Route[]): Route[] {
    return routes.map((route) => ({
        ...route,
        data: {
            ...(route.data || {}),
            layout: 'workspace',
        },
        children: route.children
            ? withWorkspaceLayout(route.children)
            : undefined,
    }));
}

export const routes: Routes = [
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'workspace',
    },
    {
        path: 'workspace',
        loadComponent: () =>
            import('@iptvnator/workspace/shell/feature').then(
                (c) => c.WorkspaceShellComponent
            ),
        children: [
            {
                path: '',
                pathMatch: 'full',
                redirectTo: 'dashboard',
            },
            {
                path: 'dashboard',
                loadComponent: () =>
                    import('workspace-dashboard-feature').then(
                        (c) => c.WorkspaceDashboardComponent
                    ),
            },
            {
                path: 'sources',
                loadComponent: () =>
                    import('@iptvnator/workspace/shell/feature').then(
                        (c) => c.WorkspaceSourcesComponent
                    ),
            },
            {
                path: 'playlists/:id',
                pathMatch: 'full',
                redirectTo: 'playlists/:id/all',
            },
            {
                path: 'playlists/:id/:view',
                data: {
                    layout: 'workspace',
                },
                loadComponent: () =>
                    import('@iptvnator/playlist/m3u/feature-player').then(
                        (c) => c.VideoPlayerComponent
                    ),
            },
            {
                path: 'global-favorites',
                data: {
                    layout: 'workspace',
                },
                loadComponent: () =>
                    import('@iptvnator/workspace/shell/feature').then(
                        (c) => c.GlobalFavoritesPageComponent
                    ),
            },
            {
                path: 'downloads',
                data: { layout: 'workspace' },
                loadComponent: () =>
                    import('@iptvnator/portal/downloads/feature').then(
                        (c) => c.DownloadsComponent
                    ),
            },
            {
                path: '',
                loadChildren: () =>
                    import('@iptvnator/portal/xtream/feature').then((m) =>
                        withWorkspaceLayout(m.createXtreamRoutes())
                    ),
            },
            {
                path: '',
                loadChildren: () =>
                    import('@iptvnator/portal/stalker/feature').then((m) =>
                        withWorkspaceLayout(m.createStalkerRoutes())
                    ),
            },
            {
                path: 'settings',
                data: { layout: 'workspace' },
                loadComponent: () =>
                    import('./settings/settings.component').then(
                        (c) => c.SettingsComponent
                    ),
            },
        ],
    },
    {
        path: 'settings',
        redirectTo: '/workspace/settings',
        pathMatch: 'full',
    },
    {
        path: '**',
        redirectTo: '',
    },
];
