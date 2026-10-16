import { Route } from '@angular/router';
import { M3uCollectionRouteComponent } from './m3u-collection-route/m3u-collection-route.component';
import { provideM3uWorkspaceRouteSession } from './m3u-workspace-route-session.service';
import { VideoPlayerComponent } from './video-player/video-player.component';

const loadCatalogRoute = () =>
    import('./m3u-catalog/m3u-catalog-route.component').then(
        (m) => m.M3uCatalogRouteComponent
    );

export function createM3uWorkspaceRoutes(): Route[] {
    return [
        {
            // One session for every M3U section. Route-level injectors live
            // for the rest of the app once created, so a session per route
            // meant one more live session per section visited, each reacting
            // to every navigation, and each new one re-reading and re-parsing
            // the whole playlist on its first visit — 62k rows rebuilt just
            // to open a series the Series grid had already indexed.
            path: '',
            providers: provideM3uWorkspaceRouteSession(),
            children: [
                {
                    path: '',
                    pathMatch: 'full',
                    redirectTo: 'all',
                },
                // Declared before the `:view` catch-all, which renders the player.
                // They reuse the portals' own section tokens so the rail tooltips,
                // the search mode and the section memory already know them.
                //
                // Loaded on demand: most M3U playlists are live-only, and
                // opening one should not fetch the catalog grid or the
                // series aggregation it never shows.
                {
                    path: 'vod',
                    loadComponent: loadCatalogRoute,
                    data: { kind: 'movie' },
                },
                {
                    path: 'series',
                    loadComponent: loadCatalogRoute,
                    data: { kind: 'episode' },
                },
                {
                    path: 'series/:seriesId',
                    loadComponent: () =>
                        import('./m3u-series-detail/m3u-series-detail-route.component').then(
                            (m) => m.M3uSeriesDetailRouteComponent
                        ),
                    data: { kind: 'episode' },
                },
                {
                    path: 'favorites',
                    component: M3uCollectionRouteComponent,
                    data: {
                        mode: 'favorites',
                        portalType: 'm3u',
                        defaultScope: 'playlist',
                    },
                },
                {
                    path: 'recent',
                    component: M3uCollectionRouteComponent,
                    data: {
                        mode: 'recent',
                        portalType: 'm3u',
                        defaultScope: 'playlist',
                    },
                },
                {
                    path: ':view',
                    component: VideoPlayerComponent,
                },
            ],
        },
    ];
}
