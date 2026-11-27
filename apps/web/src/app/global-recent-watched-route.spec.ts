import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Store } from '@ngrx/store';
import {
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
    WorkspaceBackNavigationService,
} from '@iptvnator/portal/shared/data-access';
import { UnifiedCollectionPageComponent } from '@iptvnator/portal/shared/ui';
import {
    PORTAL_PLAYBACK_POSITIONS,
    type UnifiedCollectionItem,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { DialogService } from '@iptvnator/ui/components';
import { DashboardSeriesEpisodesService } from '@iptvnator/workspace/dashboard/data-access';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';
import { TranslateModule } from '@ngx-translate/core';
import { GlobalCollectionRouteComponent } from './global-collection-route.component';

const activeSource = { _id: 'active-source', title: 'Active source' };
const otherSource = {
    _id: 'other-source',
    title: 'Synthetic source',
    serverUrl: 'https://example.test',
};

describe('Global watched history route', () => {
    const registerCommand = jest.fn(() => jest.fn());
    const openConfirmDialog = jest.fn();
    const getRecentItems = jest.fn<
        Promise<UnifiedCollectionItem[]>,
        unknown[]
    >();
    const getPlaybackPositions = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        getRecentItems.mockResolvedValue([]);
        getPlaybackPositions.mockResolvedValue([]);
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                provideRouter(
                    [
                        {
                            path: 'workspace/global-recent',
                            component: GlobalCollectionRouteComponent,
                            data: { mode: 'recent', defaultScope: 'all' },
                        },
                        {
                            path: 'workspace/global-favorites',
                            component: GlobalCollectionRouteComponent,
                            data: { mode: 'favorites', defaultScope: 'all' },
                        },
                    ],
                    withComponentInputBinding()
                ),
                {
                    provide: Store,
                    useValue: {
                        selectSignal: (selector: unknown) =>
                            selector === selectAllPlaylistsMeta
                                ? signal([activeSource, otherSource])
                                : signal(
                                      selector === selectPlaylistsLoadingFlag
                                  ),
                    },
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        activePlaylist: signal(activeSource),
                        getProviderForPlaylist: (playlist: { _id: string }) =>
                            playlist._id === otherSource._id
                                ? 'xtreams'
                                : 'playlists',
                    },
                },
                { provide: WORKSPACE_SHELL_ACTIONS, useValue: {} },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: { getAllPlaybackPositions: getPlaybackPositions },
                },
                { provide: DashboardSeriesEpisodesService, useValue: {} },
                { provide: RuntimeCapabilitiesService, useValue: {} },
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: { getFavorites: async () => [] },
                },
                {
                    provide: UnifiedRecentDataService,
                    useValue: { getRecentItems },
                },
                {
                    provide: WorkspaceViewCommandService,
                    useValue: { registerCommand },
                },
                { provide: DialogService, useValue: { openConfirmDialog } },
            ],
        });
        window.history.replaceState({}, document.title);
    });

    it('defaults a direct recent visit to all playlists and respects explicit scope', async () => {
        const harness = await RouterTestingHarness.create();
        await harness.navigateByUrl('/workspace/global-recent');
        expect(getRecentItems).toHaveBeenLastCalledWith(
            'all',
            'active-source',
            'm3u'
        );

        await harness.navigateByUrl('/workspace/global-recent?scope=playlist');
        expect(getRecentItems).toHaveBeenLastCalledWith(
            'playlist',
            'active-source',
            'm3u'
        );
    });

    it('keeps favorites playlist-scoped even with the watched query present', async () => {
        const harness = await RouterTestingHarness.create();
        const route = await harness.navigateByUrl(
            '/workspace/global-favorites?view=watched',
            GlobalCollectionRouteComponent
        );
        expect(route.effectiveDefaultScope()).toBe('playlist');
        expect(
            harness.routeNativeElement?.querySelector(
                '[data-testid="workspace-recent-watched-full"]'
            )
        ).toBeNull();
    });

    it('pins the requested playlist in the full view and does not offer Clear', async () => {
        getRecentItems.mockResolvedValue([
            {
                uid: 'xtream::other-source::movie:42',
                name: 'Synthetic movie',
                sourceType: 'xtream',
                contentType: 'movie',
                playlistId: 'other-source',
                playlistName: 'Synthetic source',
            },
        ]);
        const harness = await RouterTestingHarness.create(
            '/workspace/global-recent?view=watched&scope=playlist&playlistId=other-source'
        );

        expect(getRecentItems).toHaveBeenLastCalledWith(
            'playlist',
            'other-source',
            'xtream'
        );
        const full = harness.routeNativeElement?.querySelector(
            '[data-testid="workspace-recent-watched-full"]'
        );
        expect(full?.textContent).toContain('Synthetic source');
        expect(
            harness.routeNativeElement?.querySelector('.collection-header')
        ).toBeNull();
        expect(registerCommand).not.toHaveBeenCalled();
        const page = harness.routeDebugElement?.query(
            By.directive(UnifiedCollectionPageComponent)
        )?.componentInstance as UnifiedCollectionPageComponent;
        page.clearAllCurrent();
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it('filters the watched grid from workspace search and provides one Back target', async () => {
        getRecentItems.mockResolvedValue(
            ['Night Atlas', 'Harbour Signal'].map((name, index) => ({
                uid: `xtream::other-source::movie:${index + 1}`,
                name,
                sourceType: 'xtream',
                contentType: 'movie',
                playlistId: 'other-source',
                playlistName: 'Synthetic source',
                xtreamId: index + 1,
            }))
        );
        getPlaybackPositions.mockResolvedValue(
            [1, 2].map((contentXtreamId) => ({
                contentXtreamId,
                contentType: 'vod',
                positionSeconds: 95,
                durationSeconds: 100,
            }))
        );
        const harness = await RouterTestingHarness.create(
            '/workspace/global-recent?view=watched&q=atlas'
        );
        const route = harness.routeDebugElement
            ?.componentInstance as GlobalCollectionRouteComponent;
        for (let turn = 0; turn < 10 && !route.watched.items().length; turn++) {
            TestBed.tick();
            await Promise.resolve();
        }
        harness.detectChanges();
        expect(getPlaybackPositions).toHaveBeenCalledWith(otherSource._id);
        const full = harness.routeNativeElement?.querySelector(
            '[data-testid="workspace-recent-watched-full"]'
        );
        expect(full?.textContent).toContain('Night Atlas');
        expect(full?.textContent).not.toContain('Harbour Signal');
        expect(full?.querySelector('button')).toBeNull();
        expect(
            TestBed.inject(WorkspaceBackNavigationService).target()
        ).not.toBeNull();
    });
});
