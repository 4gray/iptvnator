import { Route } from '@angular/router';

export const xtreamRoutes: Route[] = [
    {
        path: 'xtreams/:id',
        loadComponent: () =>
            import('./xtream-shell/xtream-shell.component').then(
                (c) => c.XtreamShellComponent
            ),
        children: [
            {
                path: '',
                redirectTo: 'vod',
                pathMatch: 'full',
            },
            {
                path: 'live',
                loadComponent: () =>
                    import(
                        './live-stream-layout/live-stream-layout.component'
                    ).then((c) => c.LiveStreamLayoutComponent),
                children: [
                    {
                        path: ':categoryId',
                        loadComponent: () =>
                            import(
                                './live-stream-layout/live-stream-layout.component'
                            ).then((c) => c.LiveStreamLayoutComponent),
                    },
                ],
            },
            {
                path: 'vod',
                loadComponent: () =>
                    import('./xtream-main-container.component').then(
                        (c) => c.XtreamMainContainerComponent
                    ),
                children: [
                    {
                        path: ':categoryId',
                        loadComponent: () =>
                            import(
                                './category-content-view/category-content-view.component'
                            ).then((c) => c.CategoryContentViewComponent),
                    },
                    {
                        path: ':categoryId/:vodId',
                        loadComponent: () =>
                            import('./vod-details/vod-details.component').then(
                                (c) => c.VodDetailsComponent
                            ),
                    },
                ],
            },
            {
                path: 'series',
                loadComponent: () =>
                    import('./xtream-main-container.component').then(
                        (c) => c.XtreamMainContainerComponent
                    ),
                children: [
                    {
                        path: ':categoryId',
                        loadComponent: () =>
                            import(
                                './category-content-view/category-content-view.component'
                            ).then((c) => c.CategoryContentViewComponent),
                    },
                    {
                        path: ':categoryId/:serialId',
                        loadComponent: () =>
                            import(
                                './serial-details/serial-details.component'
                            ).then((c) => c.SerialDetailsComponent),
                    },
                ],
            },
            {
                path: 'favorites',
                loadComponent: () =>
                    import('./favorites/favorites.component').then(
                        (c) => c.FavoritesComponent
                    ),
            },
            {
                path: 'recent',
                loadComponent: () =>
                    import('./recently-viewed/recently-viewed.component').then(
                        (c) => c.RecentlyViewedComponent
                    ),
            },
            {
                path: 'search',
                loadComponent: () =>
                    import('./search-results/search-results.component').then(
                        (c) => c.SearchResultsComponent
                    ),
            },
        ],
    },
];
