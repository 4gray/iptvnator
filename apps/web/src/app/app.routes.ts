import { Route, Routes } from '@angular/router';
import { stalkerRoutes } from './stalker/stalker.routes';
import { xtreamRoutes } from './xtream-electron/xtream.routes';

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
            import('./workspace/workspace-shell.component').then(
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
                    import('./workspace/workspace-sources.component').then(
                        (c) => c.WorkspaceSourcesComponent
                    ),
            },
            {
                path: 'playlists/:id',
                data: {
                    layout: 'workspace',
                },
                loadComponent: () =>
                    import('./home/video-player/video-player.component').then(
                        (c) => c.VideoPlayerComponent
                    ),
            },
            ...withWorkspaceLayout(xtreamRoutes),
            ...withWorkspaceLayout(stalkerRoutes),
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
        path: 'home',
        loadComponent: () =>
            import('./home/home.component').then((c) => c.HomeComponent),
    },
    {
        path: 'playlists',
        loadComponent: () =>
            import('./home/video-player/video-player.component').then(
                (c) => c.VideoPlayerComponent
            ),
    },
    {
        path: 'iptv',
        loadComponent: () =>
            import('./home/video-player/video-player.component').then(
                (c) => c.VideoPlayerComponent
            ),
    },
    {
        path: 'playlists/:id',
        loadComponent: () =>
            import('./home/video-player/video-player.component').then(
                (c) => c.VideoPlayerComponent
            ),
    },
    {
        path: 'settings',
        redirectTo: '/workspace/settings',
        pathMatch: 'full',
    },
    ...xtreamRoutes,
    {
        path: 'portals/:id',
        loadComponent: () =>
            import('./stalker/stalker-main-container.component').then(
                (c) => c.StalkerMainContainerComponent
            ),
    },
    ...stalkerRoutes,
    {
        path: '**',
        redirectTo: '',
    },
];
