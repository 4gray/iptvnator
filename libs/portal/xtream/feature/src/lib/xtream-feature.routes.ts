import { Provider } from '@angular/core';
import { Route } from '@angular/router';

type ComponentLoader = NonNullable<Route['loadComponent']>;

export interface XtreamFeatureRouteOptions {
    readonly catalogProviders?: Provider[];
    readonly loadLiveStreamLayoutComponent: ComponentLoader;
    readonly loadCategoryContentViewComponent: ComponentLoader;
    readonly loadVodDetailsRouteComponent: ComponentLoader;
    readonly loadSerialDetailsComponent: ComponentLoader;
    readonly loadFavoritesComponent: ComponentLoader;
    readonly loadRecentlyViewedComponent: ComponentLoader;
    readonly loadSearchResultsComponent: ComponentLoader;
    readonly loadRecentlyAddedComponent: ComponentLoader;
}

const loadDownloadsComponent: ComponentLoader = () =>
    import('@iptvnator/portal/downloads/feature').then(
        (c) => c.DownloadsComponent
    );

const loadXtreamShellComponent: ComponentLoader = () =>
    import('./xtream-shell/xtream-shell.component').then(
        (c) => c.XtreamShellComponent
    );

const loadXtreamMainContainerComponent: ComponentLoader = () =>
    import('./xtream-main-container.component').then(
        (c) => c.XtreamMainContainerComponent
    );

export function createXtreamRoutes(
    options: XtreamFeatureRouteOptions
): Route[] {
    return [
        {
            path: 'xtreams/:id',
            loadComponent: loadXtreamShellComponent,
            children: [
                {
                    path: '',
                    redirectTo: 'vod',
                    pathMatch: 'full',
                },
                {
                    path: 'live',
                    loadComponent: options.loadLiveStreamLayoutComponent,
                    children: [
                        {
                            path: ':categoryId',
                            loadComponent:
                                options.loadLiveStreamLayoutComponent,
                        },
                    ],
                },
                {
                    path: 'vod',
                    providers: options.catalogProviders ?? [],
                    loadComponent: loadXtreamMainContainerComponent,
                    children: [
                        {
                            path: '',
                            loadComponent:
                                options.loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId',
                            loadComponent:
                                options.loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId/:vodId',
                            loadComponent:
                                options.loadVodDetailsRouteComponent,
                        },
                    ],
                },
                {
                    path: 'series',
                    providers: options.catalogProviders ?? [],
                    loadComponent: loadXtreamMainContainerComponent,
                    children: [
                        {
                            path: '',
                            loadComponent:
                                options.loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId',
                            loadComponent:
                                options.loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId/:serialId',
                            loadComponent: options.loadSerialDetailsComponent,
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
                    loadComponent: options.loadSearchResultsComponent,
                },
                {
                    path: 'recently-added',
                    loadComponent: options.loadRecentlyAddedComponent,
                },
                {
                    path: 'downloads',
                    loadComponent: loadDownloadsComponent,
                },
            ],
        },
    ];
}
