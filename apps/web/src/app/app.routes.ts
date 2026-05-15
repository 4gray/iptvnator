import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { WorkspaceStartupPreferencesService } from '@iptvnator/workspace/shell/util';

const workspaceEntryRedirect = async () =>
    inject(WorkspaceStartupPreferencesService).resolveInitialWorkspacePath();

const dashboardAccessGuard = async () => {
    const startupPreferences = inject(WorkspaceStartupPreferencesService);
    const router = inject(Router);
    const redirectPath = await startupPreferences.resolveDashboardPath();

    return redirectPath === '/workspace/dashboard'
        ? true
        : router.parseUrl(redirectPath);
};

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
                redirectTo: workspaceEntryRedirect,
            },
            {
                path: 'dashboard',
                canActivate: [dashboardAccessGuard],
                loadComponent: () =>
                    import('@iptvnator/workspace/dashboard/feature').then(
                        (c) => c.WorkspaceDashboardRailsComponent
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
                loadChildren: () =>
                    import('@iptvnator/playlist/m3u/feature-player').then((m) =>
                        m.createM3uWorkspaceRoutes()
                    ),
            },
            {
                path: 'global-favorites',
                data: {
                    mode: 'favorites',
                    defaultScope: 'all',
                },
                loadComponent: () =>
                    import('./global-collection-route.component').then(
                        (c) => c.GlobalCollectionRouteComponent
                    ),
            },
            {
                path: 'global-recent',
                data: {
                    mode: 'recent',
                    defaultScope: 'all',
                },
                loadComponent: () =>
                    import('./global-collection-route.component').then(
                        (c) => c.GlobalCollectionRouteComponent
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
