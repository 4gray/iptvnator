import { Route } from '@angular/router';

export const stalkerRoutes: Route[] = [
    {
        path: 'stalker/:id',
        loadComponent: () =>
            import('./stalker-shell/stalker-shell.component').then(
                (c) => c.StalkerShellComponent
            ),
        children: [
            {
                path: '',
                redirectTo: 'vod',
                pathMatch: 'full',
            },
            {
                path: 'vod',
                loadComponent: () =>
                    import('./stalker-main-container.component').then(
                        (c) => c.StalkerMainContainerComponent
                    ),
                children: [
                    {
                        path: ':categoryId',
                        data: {
                            api: 'stalker',
                            contentType: 'vod',
                        },
                        loadComponent: () =>
                            import(
                                '../xtream-tauri/category-content-view/category-content-view.component'
                            ).then((c) => c.CategoryContentViewComponent),
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
                loadComponent: () =>
                    import('./stalker-main-container.component').then(
                        (c) => c.StalkerMainContainerComponent
                    ),
            },
            {
                path: 'series',
                loadComponent: () =>
                    import('./stalker-main-container.component').then(
                        (c) => c.StalkerMainContainerComponent
                    ),
                children: [
                    {
                        path: ':categoryId',
                        loadComponent: () =>
                            import(
                                '../xtream-tauri/category-content-view/category-content-view.component'
                            ).then((c) => c.CategoryContentViewComponent),
                        data: {
                            api: 'stalker',
                            contentType: 'series',
                        },
                    },
                ],
            },
            {
                path: 'favorites',
                loadComponent: () =>
                    import(
                        './stalker-favorites/stalker-favorites.component'
                    ).then((c) => c.StalkerFavoritesComponent),
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
                    import('./stalker-search/stalker-search.component').then(
                        (c) => c.StalkerSearchComponent
                    ),
            },
        ],
    },
];
