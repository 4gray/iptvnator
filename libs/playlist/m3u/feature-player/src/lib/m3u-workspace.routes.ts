import { Route } from '@angular/router';
import { M3uCatalogRouteComponent } from './m3u-catalog/m3u-catalog-route.component';
import { M3uCollectionRouteComponent } from './m3u-collection-route/m3u-collection-route.component';
import { M3uSeriesDetailRouteComponent } from './m3u-series-detail/m3u-series-detail-route.component';
import { provideM3uWorkspaceRouteSession } from './m3u-workspace-route-session.service';
import { VideoPlayerComponent } from './video-player/video-player.component';

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
                {
                    path: 'vod',
                    component: M3uCatalogRouteComponent,
                    data: { kind: 'movie' },
                },
                {
                    path: 'series',
                    component: M3uCatalogRouteComponent,
                    data: { kind: 'episode' },
                },
                {
                    path: 'series/:seriesId',
                    component: M3uSeriesDetailRouteComponent,
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
