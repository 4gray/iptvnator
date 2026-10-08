import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Route, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistsService } from '@iptvnator/services';

// The route file imports the player, whose barrel reaches video.js; its CJS
// bundle cannot be evaluated under the ESM jest environment.
jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({ selector: 'app-route-stub', template: '' })
class RouteStubComponent {
    readonly route = inject(ActivatedRoute);
}

/** The real route tree with every page swapped for a stub. */
function withStubPages(routes: Route[]): Route[] {
    return routes.map((route) => ({
        ...route,
        ...(route.component || route.loadComponent
            ? { component: RouteStubComponent, loadComponent: undefined }
            : {}),
        ...(route.children ? { children: withStubPages(route.children) } : {}),
    }));
}

function m3uContextOf(url: string) {
    const [, , provider, playlistId, section] = url.split('?')[0].split('/');
    return { provider, playlistId, section: section ?? null };
}

/**
 * Wiring of the M3U route tree under a real router: which session serves
 * the sections, and that the pages still see the playlist and view params
 * through the session's componentless parent.
 */
describe('createM3uWorkspaceRoutes', () => {
    const getPlaylist = jest.fn();
    const dispatch = jest.fn();

    beforeEach(async () => {
        getPlaylist
            .mockReset()
            .mockReturnValue(of({ playlist: { items: [] }, favorites: [] }));
        dispatch.mockReset();
        const { createM3uWorkspaceRoutes } =
            await import('./m3u-workspace.routes');

        TestBed.configureTestingModule({
            providers: [
                { provide: PlaylistsService, useValue: { getPlaylist } },
                { provide: Store, useValue: { dispatch } },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        syncFromUrl: (url: string) => m3uContextOf(url),
                    },
                },
            ],
        });
        TestBed.inject(Router).resetConfig([
            {
                path: 'workspace/playlists/:id',
                children: withStubPages(createM3uWorkspaceRoutes()),
            },
        ]);
    });

    it('loads the playlist once across the loaded sections', async () => {
        // A session per route re-read and re-parsed the whole playlist on
        // the first visit to every section, the series detail included.
        const harness = await RouterTestingHarness.create();
        await harness.navigateByUrl('/workspace/playlists/pl-1/all');
        await harness.navigateByUrl('/workspace/playlists/pl-1/vod');
        await harness.navigateByUrl('/workspace/playlists/pl-1/series');
        await harness.navigateByUrl('/workspace/playlists/pl-1/series/42');
        await harness.navigateByUrl('/workspace/playlists/pl-1/groups');
        await TestBed.inject(Router).navigateByUrl(
            '/workspace/playlists/pl-1/all'
        );

        expect(getPlaylist).toHaveBeenCalledTimes(1);
        expect(getPlaylist).toHaveBeenCalledWith('pl-1');
    });

    it('still hands the pages the playlist id and their own params', async () => {
        const harness = await RouterTestingHarness.create();

        const player = await harness.navigateByUrl(
            '/workspace/playlists/pl-1/groups',
            RouteStubComponent
        );
        expect(player.route.snapshot.params).toEqual(
            expect.objectContaining({ id: 'pl-1', view: 'groups' })
        );

        const detail = await harness.navigateByUrl(
            '/workspace/playlists/pl-1/series/42',
            RouteStubComponent
        );
        expect(detail.route.snapshot.params).toEqual(
            expect.objectContaining({ id: 'pl-1', seriesId: '42' })
        );
    });

    it('loads the catalog pages on demand', async () => {
        // Most M3U playlists are live-only; opening one must not fetch the
        // catalog grid or the series aggregation.
        const { createM3uWorkspaceRoutes } =
            await import('./m3u-workspace.routes');
        const pages = createM3uWorkspaceRoutes()[0].children ?? [];

        for (const path of ['vod', 'series', 'series/:seriesId']) {
            const route = pages.find((page) => page.path === path);
            expect(route?.loadComponent).toEqual(expect.any(Function));
            expect(route?.component).toBeUndefined();
        }
    });

    it('redirects the bare playlist route to all', async () => {
        const harness = await RouterTestingHarness.create();
        await harness.navigateByUrl('/workspace/playlists/pl-1');

        expect(TestBed.inject(Router).url).toBe(
            '/workspace/playlists/pl-1/all'
        );
    });
});
