import { Route } from '@angular/router';
import { PORTAL_CATALOG_DETAIL_COMPONENT } from '@iptvnator/portal/shared/util';
import { StalkerCatalogDetailComponent } from './stalker-catalog-detail/stalker-catalog-detail.component';
import { provideStalkerCatalogFacade } from './stalker-catalog-facade.service';
import { provideStalkerWorkspaceRouteSession } from './stalker-workspace-route-session.service';

type ComponentLoader = NonNullable<Route['loadComponent']>;

const loadDownloadsComponent: ComponentLoader = () =>
    import('@iptvnator/portal/downloads/feature').then(
        (c) => c.DownloadsComponent
    );

const loadStalkerLiveStreamLayoutComponent: ComponentLoader = () =>
    import('./stalker-live-stream-layout/stalker-live-stream-layout.component').then(
        (c) => c.StalkerLiveStreamLayoutComponent
    );

const loadCategoryContentViewComponent: ComponentLoader = () =>
    import('@iptvnator/portal/catalog/feature').then(
        (c) => c.CategoryContentViewComponent
    );

const loadStalkerCollectionRouteComponent: ComponentLoader = () =>
    import('./stalker-collection-route.component').then(
        (c) => c.StalkerCollectionRouteComponent
    );

const loadStalkerSearchComponent: ComponentLoader = () =>
    import('./stalker-search/stalker-search.component').then(
        (c) => c.StalkerSearchComponent
    );

export function createStalkerRoutes(): Route[] {
    return [
        {
            path: 'stalker/:id',
            providers: provideStalkerWorkspaceRouteSession(),
            children: [
                {
                    path: '',
                    redirectTo: 'vod',
                    pathMatch: 'full',
                },
                {
                    path: 'vod',
                    providers: [
                        ...provideStalkerCatalogFacade(),
                        {
                            provide: PORTAL_CATALOG_DETAIL_COMPONENT,
                            useValue: StalkerCatalogDetailComponent,
                        },
                    ],
                    children: [
                        {
                            path: '',
                            data: {
                                api: 'stalker',
                                contentType: 'vod',
                            },
                            loadComponent: loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId',
                            data: {
                                api: 'stalker',
                                contentType: 'vod',
                            },
                            loadComponent: loadCategoryContentViewComponent,
                        },
                    ],
                },
                {
                    path: 'itv',
                    loadComponent: loadStalkerLiveStreamLayoutComponent,
                },
                {
                    path: 'series',
                    providers: [
                        ...provideStalkerCatalogFacade(),
                        {
                            provide: PORTAL_CATALOG_DETAIL_COMPONENT,
                            useValue: StalkerCatalogDetailComponent,
                        },
                    ],
                    children: [
                        {
                            path: '',
                            data: {
                                api: 'stalker',
                                contentType: 'series',
                            },
                            loadComponent: loadCategoryContentViewComponent,
                        },
                        {
                            path: ':categoryId',
                            data: {
                                api: 'stalker',
                                contentType: 'series',
                            },
                            loadComponent: loadCategoryContentViewComponent,
                        },
                    ],
                },
                {
                    path: 'favorites',
                    loadComponent: loadStalkerCollectionRouteComponent,
                    data: { mode: 'favorites', portalType: 'stalker' },
                },
                {
                    path: 'recent',
                    loadComponent: loadStalkerCollectionRouteComponent,
                    data: { mode: 'recent', portalType: 'stalker' },
                },
                {
                    path: 'search',
                    loadComponent: loadStalkerSearchComponent,
                },
                {
                    path: 'downloads',
                    loadComponent: loadDownloadsComponent,
                },
            ],
        },
    ];
}
