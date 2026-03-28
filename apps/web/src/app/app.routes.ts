import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'workspace',
    },
    {
        path: 'workspace',
        data: {
            layout: 'workspace',
        },
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
                path: 'playlists/:id/favorites',
                loadComponent: () =>
                    import('@iptvnator/playlist/m3u/feature-player').then(
                        (c) => c.M3uCollectionRouteComponent
                    ),
                data: {
                    mode: 'favorites',
                    portalType: 'm3u',
                },
            },
            {
                path: 'playlists/:id/recent',
                loadComponent: () =>
                    import('@iptvnator/playlist/m3u/feature-player').then(
                        (c) => c.M3uCollectionRouteComponent
                    ),
                data: {
                    mode: 'recent',
                    portalType: 'm3u',
                },
            },
            {
                path: 'playlists/:id/:view',
                loadComponent: () =>
                    import('@iptvnator/playlist/m3u/feature-player').then(
                        (c) => c.VideoPlayerComponent
                    ),
            },
            {
                path: 'global-favorites',
                data: {
                    mode: 'favorites',
                    defaultScope: 'all',
                },
                loadComponent: () =>
                    import('@iptvnator/portal/shared/ui').then(
                        (c) => c.UnifiedCollectionPageComponent
                    ),
            },
            {
                path: 'global-recent',
                data: {
                    mode: 'recent',
                    defaultScope: 'all',
                },
                loadComponent: () =>
                    import('@iptvnator/portal/shared/ui').then(
                        (c) => c.UnifiedCollectionPageComponent
                    ),
            },
            {
                path: 'downloads',
                loadComponent: () =>
                    import('@iptvnator/portal/downloads/feature').then(
                        (c) => c.DownloadsComponent
                    ),
            },
            {
                path: '',
                loadChildren: () =>
                    import('@iptvnator/portal/xtream/feature').then((m) =>
                        m.createXtreamRoutes()
                    ),
            },
            {
                path: '',
                loadChildren: () =>
                    import('@iptvnator/portal/stalker/feature').then((m) =>
                        m.createStalkerRoutes()
                    ),
            },
            {
                path: 'settings',
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
