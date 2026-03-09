import { Route } from '@angular/router';
import { provideXtreamCatalogFacade } from './xtream-catalog-facade.service';

type ComponentLoader = NonNullable<Route['loadComponent']>;

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

const loadLiveStreamLayoutComponent: ComponentLoader = () =>
    import('./live-stream-layout/live-stream-layout.component').then(
        (c) => c.LiveStreamLayoutComponent
    );

const loadCategoryContentViewComponent: ComponentLoader = () =>
    import('@iptvnator/portal/catalog/feature').then(
        (c) => c.CategoryContentViewComponent
    );

const loadFavoritesComponent: ComponentLoader = () =>
    import('./favorites/favorites.component').then((c) => c.FavoritesComponent);

const loadRecentlyViewedComponent: ComponentLoader = () =>
    import('./recently-viewed/recently-viewed.component').then(
        (c) => c.RecentlyViewedComponent
    );

const loadSearchResultsComponent: ComponentLoader = () =>
    import('./search-results/search-results.component').then(
        (c) => c.SearchResultsComponent
    );

const loadRecentlyAddedComponent: ComponentLoader = () =>
    import('./recently-added/recently-added.component').then(
        (c) => c.RecentlyAddedComponent
    );

const loadVodDetailsRouteComponent: ComponentLoader = () =>
    import('./vod-details/vod-details-route.component').then(
        (c) => c.VodDetailsRouteComponent
    );

const loadSerialDetailsComponent: ComponentLoader = () =>
    import('./serial-details/serial-details.component').then(
        (c) => c.SerialDetailsComponent
    );

export function createXtreamRoutes(): Route[] {
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
                    loadComponent: loadLiveStreamLayoutComponent,
                    children: [
                        {
                            path: ':categoryId',
                            loadComponent: loadLiveStreamLayoutComponent,
                        },
                    ],
                },
                {
                    path: 'vod',
                    providers: provideXtreamCatalogFacade(),
                    loadComponent: loadXtreamMainContainerComponent,
                    children: [
                        {
                            path: '',
                            loadComponent: loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId',
                            loadComponent: loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId/:vodId',
                            loadComponent: loadVodDetailsRouteComponent,
                        },
                    ],
                },
                {
                    path: 'series',
                    providers: provideXtreamCatalogFacade(),
                    loadComponent: loadXtreamMainContainerComponent,
                    children: [
                        {
                            path: '',
                            loadComponent: loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId',
                            loadComponent: loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId/:serialId',
                            loadComponent: loadSerialDetailsComponent,
                        },
                    ],
                },
                {
                    path: 'favorites',
                    loadComponent: loadFavoritesComponent,
                },
                {
                    path: 'recent',
                    loadComponent: loadRecentlyViewedComponent,
                },
                {
                    path: 'search',
                    loadComponent: loadSearchResultsComponent,
                },
                {
                    path: 'recently-added',
                    loadComponent: loadRecentlyAddedComponent,
                },
                {
                    path: 'downloads',
                    loadComponent: loadDownloadsComponent,
                },
            ],
        },
    ];
}
