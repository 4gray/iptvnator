import { Route } from '@angular/router';
import { provideXtreamCatalogFacade } from './xtream-catalog-facade.service';
import { provideXtreamWorkspaceRouteSession } from './xtream-workspace-route-session.service';

type ComponentLoader = NonNullable<Route['loadComponent']>;

const loadDownloadsComponent: ComponentLoader = () =>
    import('@iptvnator/portal/downloads/feature').then(
        (c) => c.DownloadsComponent
    );

const loadXtreamContentGateComponent: ComponentLoader = () =>
    import('./xtream-content-gate.component').then(
        (c) => c.XtreamContentGateComponent
    );

const loadLiveStreamLayoutComponent: ComponentLoader = () =>
    import('./live-stream-layout/live-stream-layout.component').then(
        (c) => c.LiveStreamLayoutComponent
    );

const loadCategoryContentViewComponent: ComponentLoader = () =>
    import('@iptvnator/portal/catalog/feature').then(
        (c) => c.CategoryContentViewComponent
    );

const loadXtreamCollectionRouteComponent: ComponentLoader = () =>
    import('./xtream-collection-route.component').then(
        (c) => c.XtreamCollectionRouteComponent
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
            providers: provideXtreamWorkspaceRouteSession(),
            children: [
                {
                    path: '',
                    redirectTo: 'vod',
                    pathMatch: 'full',
                },
                {
                    path: '',
                    loadComponent: loadXtreamContentGateComponent,
                    children: [
                        {
                            path: 'live',
                            loadComponent: loadLiveStreamLayoutComponent,
                        },
                        {
                            path: 'live/:categoryId',
                            loadComponent: loadLiveStreamLayoutComponent,
                        },
                        {
                            path: 'vod',
                            providers: provideXtreamCatalogFacade(),
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
                            path: 'search',
                            loadComponent: loadSearchResultsComponent,
                        },
                        {
                            path: 'recently-added',
                            loadComponent: loadRecentlyAddedComponent,
                        },
                    ],
                },
                {
                    path: 'favorites',
                    loadComponent: loadXtreamCollectionRouteComponent,
                    data: { mode: 'favorites', portalType: 'xtream' },
                },
                {
                    path: 'recent',
                    loadComponent: loadXtreamCollectionRouteComponent,
                    data: { mode: 'recent', portalType: 'xtream' },
                },
                {
                    path: 'downloads',
                    loadComponent: loadDownloadsComponent,
                },
            ],
        },
    ];
}
