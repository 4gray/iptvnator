import { XtreamFeatureRouteOptions } from '@iptvnator/portal/xtream/feature';
import { provideXtreamCatalogFacade } from './xtream-catalog-facade.service';

// Temporary app-side loader map while route screens are still being migrated
// out of apps/web into the Xtream feature library.
export const xtreamFeatureRouteOptions: XtreamFeatureRouteOptions = {
    catalogProviders: provideXtreamCatalogFacade(),
    loadLiveStreamLayoutComponent: () =>
        import('./live-stream-layout/live-stream-layout.component').then(
            (c) => c.LiveStreamLayoutComponent
        ),
    loadCategoryContentViewComponent: () =>
        import(
            '../portal-shared/category-content-view/category-content-view.component'
        ).then((c) => c.CategoryContentViewComponent),
    loadVodDetailsRouteComponent: () =>
        import('./vod-details/vod-details-route.component').then(
            (c) => c.VodDetailsRouteComponent
        ),
    loadSerialDetailsComponent: () =>
        import('./serial-details/serial-details.component').then(
            (c) => c.SerialDetailsComponent
        ),
    loadFavoritesComponent: () =>
        import('./favorites/favorites.component').then(
            (c) => c.FavoritesComponent
        ),
    loadRecentlyViewedComponent: () =>
        import('./recently-viewed/recently-viewed.component').then(
            (c) => c.RecentlyViewedComponent
        ),
    loadSearchResultsComponent: () =>
        import('./search-results/search-results.component').then(
            (c) => c.SearchResultsComponent
        ),
    loadRecentlyAddedComponent: () =>
        import('./recently-added/recently-added.component').then(
            (c) => c.RecentlyAddedComponent
        ),
};
