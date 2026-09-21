import { Route } from '@angular/router';
import { M3uCatalogRouteComponent } from './m3u-catalog/m3u-catalog-route.component';
import { M3uCollectionRouteComponent } from './m3u-collection-route/m3u-collection-route.component';
import { provideM3uWorkspaceRouteSession } from './m3u-workspace-route-session.service';
import { VideoPlayerComponent } from './video-player/video-player.component';

export function createM3uWorkspaceRoutes(): Route[] {
    return [
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
            providers: provideM3uWorkspaceRouteSession(),
            component: M3uCatalogRouteComponent,
            data: { kind: 'movie' },
        },
        {
            path: 'series',
            providers: provideM3uWorkspaceRouteSession(),
            component: M3uCatalogRouteComponent,
            data: { kind: 'episode' },
        },
        {
            path: 'favorites',
            providers: provideM3uWorkspaceRouteSession(),
            component: M3uCollectionRouteComponent,
            data: {
                mode: 'favorites',
                portalType: 'm3u',
                defaultScope: 'playlist',
            },
        },
        {
            path: 'recent',
            providers: provideM3uWorkspaceRouteSession(),
            component: M3uCollectionRouteComponent,
            data: {
                mode: 'recent',
                portalType: 'm3u',
                defaultScope: 'playlist',
            },
        },
        {
            path: ':view',
            providers: provideM3uWorkspaceRouteSession(),
            component: VideoPlayerComponent,
        },
    ];
}
