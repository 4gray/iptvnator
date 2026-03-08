import { StalkerFeatureRouteOptions } from '@iptvnator/portal/stalker/feature';
import { provideStalkerCatalogFacade } from './stalker-catalog-facade.service';

// Temporary app-side loader map while Stalker route screens remain in apps/web.
export const stalkerFeatureRouteOptions: StalkerFeatureRouteOptions = {
    catalogProviders: provideStalkerCatalogFacade(),
    loadShellComponent: () =>
        import('./stalker-shell/stalker-shell.component').then(
            (c) => c.StalkerShellComponent
        ),
    loadMainContainerComponent: () =>
        import('./stalker-main-container.component').then(
            (c) => c.StalkerMainContainerComponent
        ),
    loadCategoryContentViewComponent: () =>
        import(
            '../portal-shared/category-content-view/category-content-view.component'
        ).then((c) => c.CategoryContentViewComponent),
    loadLiveStreamLayoutComponent: () =>
        import(
            './stalker-live-stream-layout/stalker-live-stream-layout.component'
        ).then((c) => c.StalkerLiveStreamLayoutComponent),
    loadFavoritesComponent: () =>
        import('./stalker-favorites/stalker-favorites.component').then(
            (c) => c.StalkerFavoritesComponent
        ),
    loadRecentlyViewedComponent: () =>
        import('./recently-viewed/recently-viewed.component').then(
            (c) => c.RecentlyViewedComponent
        ),
    loadSearchComponent: () =>
        import('./stalker-search/stalker-search.component').then(
            (c) => c.StalkerSearchComponent
        ),
};
