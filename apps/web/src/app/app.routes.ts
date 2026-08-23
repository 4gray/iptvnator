import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { WorkspaceStartupPreferencesService } from '@iptvnator/workspace/shell/util';
import { settingsUnsavedChangesGuard } from './settings/settings-unsaved-changes.guard';

const settingsReadyResolver = () => inject(SettingsStore).loadSettings();

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

export function resolveElectronOnlyGlobalSearchRoute(
    runtime: Pick<RuntimeCapabilitiesService, 'isElectron'>,
    router: Pick<Router, 'parseUrl'>
) {
    return runtime.isElectron ? true : router.parseUrl('/workspace/sources');
}

const electronOnlyGlobalSearchGuard = () => {
    return resolveElectronOnlyGlobalSearchRoute(
        inject(RuntimeCapabilitiesService),
        inject(Router)
    );
};

/**
 * The focused recording detail depends on `RecordingsService`, whose list
 * never becomes authoritative without the recordings capability — the PWA
 * would render a permanently blank workspace instead of the not-found
 * redirect. Send it to the manager, which owns its own unavailable state.
 */
export function resolveRecordingsCapabilityRoute(
    runtime: Pick<RuntimeCapabilitiesService, 'supportsRecordings'>,
    router: Pick<Router, 'parseUrl'>
) {
    return runtime.supportsRecordings
        ? true
        : router.parseUrl('/workspace/downloads');
}

const recordingsCapabilityGuard = () => {
    return resolveRecordingsCapabilityRoute(
        inject(RuntimeCapabilitiesService),
        inject(Router)
    );
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
        resolve: {
            settingsReady: settingsReadyResolver,
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
                path: 'search',
                canActivate: [electronOnlyGlobalSearchGuard],
                data: {
                    isGlobalSearch: true,
                },
                loadComponent: () =>
                    import('@iptvnator/portal/xtream/feature').then(
                        (c) => c.GlobalSearchResultsComponent
                    ),
            },
            {
                path: 'downloads/recording/:recordingId',
                canActivate: [recordingsCapabilityGuard],
                loadComponent: () =>
                    import('@iptvnator/portal/downloads/feature').then(
                        (c) => c.RecordingDetailComponent
                    ),
            },
            {
                path: 'downloads/:downloadId',
                loadComponent: () =>
                    import('@iptvnator/portal/downloads/feature').then(
                        (c) => c.DownloadOfflineDetailComponent
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
                children: [
                    {
                        path: '',
                        pathMatch: 'full',
                        redirectTo: 'general',
                    },
                    {
                        // One routed component for every section: the same
                        // instance survives :section param changes (default
                        // route reuse), so the settings form — and its dirty
                        // state — persists while the user moves between
                        // section pages. The guard only intercepts leaving
                        // the settings area with unsaved edits.
                        path: ':section',
                        canDeactivate: [settingsUnsavedChangesGuard],
                        loadComponent: () =>
                            import('./settings/settings.component').then(
                                (c) => c.SettingsComponent
                            ),
                    },
                ],
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
