import { Provider } from '@angular/core';
import { Route } from '@angular/router';

type ComponentLoader = NonNullable<Route['loadComponent']>;

export interface StalkerFeatureRouteOptions {
    readonly catalogProviders?: Provider[];
    readonly loadCategoryContentViewComponent: ComponentLoader;
    readonly loadLiveStreamLayoutComponent: ComponentLoader;
    readonly loadFavoritesComponent: ComponentLoader;
    readonly loadRecentlyViewedComponent: ComponentLoader;
    readonly loadSearchComponent: ComponentLoader;
}

const loadDownloadsComponent: ComponentLoader = () =>
    import('@iptvnator/portal/downloads/feature').then(
        (c) => c.DownloadsComponent
    );

const loadStalkerShellComponent: ComponentLoader = () =>
    import('./stalker-shell/stalker-shell.component').then(
        (c) => c.StalkerShellComponent
    );

const loadStalkerMainContainerComponent: ComponentLoader = () =>
    import('./stalker-main-container.component').then(
        (c) => c.StalkerMainContainerComponent
    );

export function createStalkerRoutes(
    options: StalkerFeatureRouteOptions
): Route[] {
    return [
        {
            path: 'stalker/:id',
            loadComponent: loadStalkerShellComponent,
            children: [
                {
                    path: '',
                    redirectTo: 'vod',
                    pathMatch: 'full',
                },
                {
                    path: 'vod',
                    providers: options.catalogProviders ?? [],
                    loadComponent: loadStalkerMainContainerComponent,
                    children: [
                        {
                            path: '',
                            data: {
                                api: 'stalker',
                                contentType: 'vod',
                            },
                            loadComponent:
                                options.loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId',
                            data: {
                                api: 'stalker',
                                contentType: 'vod',
                            },
                            loadComponent:
                                options.loadCategoryContentViewComponent,
                        },
                    ],
                },
                {
                    path: '',
                    redirectTo: 'vod',
                    pathMatch: 'full',
                },
                {
                    path: 'itv',
                    loadComponent: options.loadLiveStreamLayoutComponent,
                },
                {
                    path: 'series',
                    providers: options.catalogProviders ?? [],
                    loadComponent: loadStalkerMainContainerComponent,
                    children: [
                        {
                            path: '',
                            data: {
                                api: 'stalker',
                                contentType: 'series',
                            },
                            loadComponent:
                                options.loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId',
                            data: {
                                api: 'stalker',
                                contentType: 'series',
                            },
                            loadComponent:
                                options.loadCategoryContentViewComponent,
                        },
                    ],
                },
                {
                    path: 'favorites',
                    loadComponent: options.loadFavoritesComponent,
                },
                {
                    path: 'recent',
                    loadComponent: options.loadRecentlyViewedComponent,
                },
                {
                    path: 'search',
                    loadComponent: options.loadSearchComponent,
                },
                {
                    path: 'downloads',
                    loadComponent: loadDownloadsComponent,
                },
            ],
        },
    ];
}
