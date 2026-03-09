import { Route } from '@angular/router';
import { provideStalkerCatalogFacade } from './stalker-catalog-facade.service';

type ComponentLoader = NonNullable<Route['loadComponent']>;

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

const loadStalkerLiveStreamLayoutComponent: ComponentLoader = () =>
    import('./stalker-live-stream-layout/stalker-live-stream-layout.component').then(
        (c) => c.StalkerLiveStreamLayoutComponent
    );

const loadCategoryContentViewComponent: ComponentLoader = () =>
    import('@iptvnator/portal/catalog/feature').then(
        (c) => c.CategoryContentViewComponent
    );

const loadStalkerFavoritesComponent: ComponentLoader = () =>
    import('./stalker-favorites/stalker-favorites.component').then(
        (c) => c.StalkerFavoritesComponent
    );

const loadStalkerRecentlyViewedComponent: ComponentLoader = () =>
    import('./recently-viewed/recently-viewed.component').then(
        (c) => c.RecentlyViewedComponent
    );

const loadStalkerSearchComponent: ComponentLoader = () =>
    import('./stalker-search/stalker-search.component').then(
        (c) => c.StalkerSearchComponent
    );

export function createStalkerRoutes(): Route[] {
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
                    providers: provideStalkerCatalogFacade(),
                    loadComponent: loadStalkerMainContainerComponent,
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
                    path: '',
                    redirectTo: 'vod',
                    pathMatch: 'full',
                },
                {
                    path: 'itv',
                    loadComponent: loadStalkerLiveStreamLayoutComponent,
                },
                {
                    path: 'series',
                    providers: provideStalkerCatalogFacade(),
                    loadComponent: loadStalkerMainContainerComponent,
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
                    loadComponent: loadStalkerFavoritesComponent,
                },
                {
                    path: 'recent',
                    loadComponent: loadStalkerRecentlyViewedComponent,
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
