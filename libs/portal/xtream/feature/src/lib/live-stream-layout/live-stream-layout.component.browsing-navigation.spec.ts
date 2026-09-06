import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    ActivatedRoute,
    NavigationEnd,
    Router,
    convertToParamMap,
} from '@angular/router';
import { MockPipe } from 'ng-mocks';
import { TranslatePipe } from '@ngx-translate/core';
import { BehaviorSubject, Subject } from 'rxjs';
import {
    LIVE_EPG_PANEL_STATE_STORAGE_KEY,
    liveSidebarStateStorageKey,
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
    ResizableDirective,
} from '@iptvnator/portal/shared/util';
import {
    FavoritesService,
    XtreamStore,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { EpgListViewComponent, EpgTimelineComponent } from '@iptvnator/ui/epg';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { GridListComponent } from '@iptvnator/portal/shared/ui';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    LIVE_CHANNEL_SORT_STORAGE_KEY,
    StubEpgTimelineComponent,
    StubGridListComponent,
    StubPortalChannelsListComponent,
    StubResizableDirective,
    StubWebPlayerViewComponent,
    categories,
    categoryItemCounts,
    currentEpgItem,
    currentPlaylist,
    epgItems,
    favoritesService,
    fixedNow,
    hasMoreContent,
    isLoadingEpg,
    liveStreams,
    paginatedContent,
    playlist,
    portalPlayer,
    sampleChannel,
    selectedCategoryId,
    selectedContentType,
    selectedItem,
    selectedTypeContentLoading,
    settingsStore,
    xtreamStore,
    xtreamUrlService,
} from './live-stream-layout.spec-harness';

// Split out of live-stream-layout.component.spec.ts, which sits at the
// 1200-line test cap (max-lines). These cases cover channel navigation while
// browsing: remote-control navigation that must preserve the browsing order
// (#1554), and the Ctrl+F "auto-open" flow driven by router NavigationEnd.
describe('LiveStreamLayoutComponent - browsing navigation', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    let routeQueryParamMap: BehaviorSubject<
        ReturnType<typeof convertToParamMap>
    >;

    let routerEvents: Subject<unknown>;
    let router: { events: Subject<unknown>; navigate: jest.Mock };

    const originalElectron = window.electron;

    beforeEach(async () => {
        currentPlaylist.set(playlist);
        jest.useFakeTimers();
        jest.setSystemTime(fixedNow);
        settingsStore.resolvedEpgViewMode.set('timeline');
        localStorage.removeItem(LIVE_CHANNEL_SORT_STORAGE_KEY);
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        localStorage.removeItem(liveSidebarStateStorageKey('portal'));
        settingsStore.openStreamOnDoubleClick.set(false);

        window.electron = {
            updateRemoteControlStatus: jest.fn(),
            onChannelChange: jest.fn(() => jest.fn()),
            onRemoteControlCommand: jest.fn(() => jest.fn()),
        } as typeof window.electron;

        routerEvents = new Subject();
        router = { events: routerEvents, navigate: jest.fn() };
        xtreamStore.constructStreamUrl.mockClear();
        xtreamStore.openPlayer.mockClear();
        xtreamStore.setSelectedItem.mockClear();
        xtreamStore.setSelectedCategory.mockClear();
        xtreamStore.loadMoreContent.mockClear();
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([
            sampleChannel,
        ]);
        liveStreams.set([]);
        paginatedContent.set([]);
        hasMoreContent.set(false);
        favoritesService.getFavorites.mockClear();
        xtreamUrlService.resolveCatchupUrl.mockClear();
        portalPlayer.isEmbeddedPlayer.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        portalPlayer.openExternalPlayback.mockClear();

        epgItems.set([]);
        currentEpgItem.set(null);
        isLoadingEpg.set(false);
        categories.set([{ category_id: 1, category_name: 'News' }]);
        categoryItemCounts.set(new Map<number, number>([[1, 1]]));
        selectedTypeContentLoading.set(false);
        selectedCategoryId.set(1);
        selectedContentType.set('live');
        selectedItem.set(sampleChannel);
        currentPlaylist.set(playlist);
        routeQueryParamMap = new BehaviorSubject(convertToParamMap({}));

        await TestBed.configureTestingModule({
            imports: [LiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({}),
                        },
                        queryParamMap: routeQueryParamMap.asObservable(),
                        pathFromRoot: [
                            {
                                snapshot: {
                                    data: { layout: 'workspace' },
                                },
                            },
                        ],
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        events: router.events.asObservable(),
                        navigate: router.navigate,
                    },
                },
                { provide: XtreamStore, useValue: xtreamStore },
                { provide: FavoritesService, useValue: favoritesService },
                { provide: XtreamUrlService, useValue: xtreamUrlService },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                        get isElectron() {
                            return Boolean(window.electron);
                        },
                        get supportsRemoteControl() {
                            return Boolean(
                                window.electron?.updateRemoteControlStatus &&
                                window.electron.onChannelChange &&
                                window.electron.onRemoteControlCommand
                            );
                        },
                    },
                },
                { provide: SettingsStore, useValue: settingsStore },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
            ],
        })
            .overrideComponent(LiveStreamLayoutComponent, {
                remove: {
                    imports: [
                        EpgListViewComponent,
                        EpgTimelineComponent,
                        GridListComponent,
                        PortalChannelsListComponent,
                        ResizableDirective,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubEpgTimelineComponent,
                        StubGridListComponent,
                        StubPortalChannelsListComponent,
                        StubResizableDirective,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                        StubWebPlayerViewComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;

        TestBed.inject(LiveLayoutSidebarStateService).setState(
            'portal',
            'expanded'
        );
    });

    afterEach(() => {
        TestBed.inject(LiveLayoutSidebarStateService).setState(
            'portal',
            'expanded'
        );
        fixture.destroy();
        jest.useRealTimers();
        localStorage.removeItem(LIVE_CHANNEL_SORT_STORAGE_KEY);
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        localStorage.removeItem(liveSidebarStateStorageKey('portal'));
        window.electron = originalElectron;
    });

    it('keeps remote order after browsing another category and changing sort', () => {
        const first = { ...sampleChannel, category_id: '1', name: 'Zulu' };
        const next = { ...first, xtream_id: 102, name: 'Alpha' };
        liveStreams.set([first, next]);
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([
            first,
            next,
        ]);
        selectedItem.set(first);
        component.playLive(first);
        xtreamStore.setSelectedCategory.mockClear();
        selectedCategoryId.set(2);
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([]);
        component.setLiveChannelSortMode('name-desc');
        component['handleRemoteChannelChange']('down');
        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(next);
        expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalled();
    });

    it('starts external playback from remote channel navigation when double-click opening is enabled', () => {
        const nextChannel = {
            ...sampleChannel,
            category_id: '1',
            xtream_id: 102,
            name: 'Channel 102',
        };
        settingsStore.openStreamOnDoubleClick.set(true);
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
        selectedItem.set(sampleChannel);
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([
            sampleChannel,
            nextChannel,
        ]);

        liveStreams.set([{ ...sampleChannel, category_id: '1' }, nextChannel]);
        component.playLive(sampleChannel);
        xtreamStore.openPlayer.mockClear();
        (
            component as unknown as {
                handleRemoteChannelChange(direction: 'up' | 'down'): void;
            }
        ).handleRemoteChannelChange('down');

        expect(xtreamStore.openPlayer).toHaveBeenCalledWith(
            'https://example.com/live.ts',
            'Channel 102',
            'channel-101.png'
        );
    });

    describe('auto-open from Ctrl+F search navigation state', () => {
        const searchChannel = {
            xtream_id: 202,
            name: 'Search Channel',
            category_id: '7',
            stream_icon: 'search-channel.png',
            tv_archive: 0,
            tv_archive_duration: 0,
        };

        function triggerNavigationEnd() {
            routerEvents.next(
                new NavigationEnd(
                    1,
                    '/workspace/xtreams/playlist-1/live',
                    '/workspace/xtreams/playlist-1/live'
                )
            );
        }

        beforeEach(() => {
            window.history.replaceState(
                { openXtreamLiveItemId: searchChannel.xtream_id },
                ''
            );
        });

        afterEach(() => {
            window.history.replaceState({}, '');
        });

        it('plays and selects a channel found in liveStreams on NavigationEnd', () => {
            liveStreams.set([searchChannel]);
            fixture.detectChanges();

            triggerNavigationEnd();
            fixture.detectChanges();

            expect(xtreamStore.constructStreamUrl).toHaveBeenCalledWith(
                searchChannel
            );
            expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(
                searchChannel
            );
        });

        it('sets the channel category so the sidebar highlights the correct entry', () => {
            liveStreams.set([searchChannel]);
            fixture.detectChanges();

            triggerNavigationEnd();
            fixture.detectChanges();

            expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(7);
        });

        it('does not auto-open while selectedContentType is not live', () => {
            selectedContentType.set('vod');
            liveStreams.set([searchChannel]);
            fixture.detectChanges();

            triggerNavigationEnd();
            fixture.detectChanges();

            expect(xtreamStore.constructStreamUrl).not.toHaveBeenCalledWith(
                searchChannel
            );
        });

        it('waits for liveStreams to populate before playing', () => {
            liveStreams.set([]);
            fixture.detectChanges();

            triggerNavigationEnd();
            fixture.detectChanges();

            expect(xtreamStore.constructStreamUrl).not.toHaveBeenCalled();

            liveStreams.set([searchChannel]);
            fixture.detectChanges();

            expect(xtreamStore.constructStreamUrl).toHaveBeenCalledWith(
                searchChannel
            );
        });

        it('clears the pending ID when the channel is not found in liveStreams', () => {
            liveStreams.set([{ ...searchChannel, xtream_id: 999 }]);
            fixture.detectChanges();

            triggerNavigationEnd();
            fixture.detectChanges();

            expect(xtreamStore.constructStreamUrl).not.toHaveBeenCalledWith(
                searchChannel
            );
        });

        it('re-triggers auto-open on re-navigation when component is reused', () => {
            liveStreams.set([searchChannel]);
            fixture.detectChanges();

            // First navigation — clears the pending state
            triggerNavigationEnd();
            fixture.detectChanges();
            xtreamStore.constructStreamUrl.mockClear();

            // Simulate navigating away and back with the same state
            window.history.replaceState(
                { openXtreamLiveItemId: searchChannel.xtream_id },
                ''
            );
            triggerNavigationEnd();
            fixture.detectChanges();

            expect(xtreamStore.constructStreamUrl).toHaveBeenCalledWith(
                searchChannel
            );
        });
    });
});
