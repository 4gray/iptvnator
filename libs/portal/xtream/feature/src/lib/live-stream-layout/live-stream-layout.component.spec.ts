import { Directive, Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    ActivatedRoute,
    NavigationEnd,
    Router,
    convertToParamMap,
} from '@angular/router';
import { MockPipe } from 'ng-mocks';
import { TranslatePipe } from '@ngx-translate/core';
import { BehaviorSubject, Subject, of } from 'rxjs';
import {
    LIVE_EPG_PANEL_STATE_STORAGE_KEY,
    LIVE_SIDEBAR_STATE_STORAGE_KEY,
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
    ResizableDirective,
} from '@iptvnator/portal/shared/util';
import {
    FavoritesService,
    XtreamStore,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { EpgListComponent, EpgProgramActivationEvent } from '@iptvnator/ui/epg';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import {
    EpgViewComponent,
    LiveEpgPanelComponent,
    LiveEpgPanelSummary,
} from '@iptvnator/ui/shared-portals';
import { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import { GridListComponent } from '@iptvnator/portal/shared/ui';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { PageEvent } from '@angular/material/paginator';

const LIVE_CHANNEL_SORT_STORAGE_KEY = 'xtream-live-channel-sort-mode';

@Component({
    selector: 'app-portal-channels-list',
    standalone: true,
    template: '<div data-test-id="portal-channels-list-stub"></div>',
})
class StubPortalChannelsListComponent {
    readonly sortMode = input<'server' | 'name-asc' | 'name-desc'>('server');
    readonly channelsOverride = input<unknown[] | null>(null);
    readonly searchTermInput = input('');
    readonly playClicked = output<unknown>();
    readonly playbackRequested = output<unknown>();
}

@Component({
    selector: 'app-grid-list',
    standalone: true,
    template: '<div data-test-id="grid-list-stub"></div>',
})
class StubGridListComponent {
    readonly items = input<unknown[]>([]);
    readonly isLoading = input(false);
    readonly showPaginator = input(true);
    readonly searchTerm = input('');
    readonly pageIndex = input(0);
    readonly totalPages = input(0);
    readonly limit = input(25);
    readonly pageSizeOptions = input<number[]>([]);
    readonly variant = input<'poster' | 'logo'>('poster');
    readonly type = input<string>();
    readonly itemClicked = output<unknown>();
    readonly pageChange = output<PageEvent>();
}

@Component({
    selector: 'app-web-player-view',
    standalone: true,
    template: '',
})
class StubWebPlayerViewComponent {
    readonly streamUrl = input('');
    readonly title = input('');
    readonly playback = input<unknown>(null);
    readonly externalFallbackRequested = output<unknown>();
}

@Component({
    selector: 'app-epg-view',
    standalone: true,
    template: '',
})
class StubEpgViewComponent {
    readonly epgItems = input<EpgItem[]>([]);
}

@Component({
    selector: 'app-epg-list',
    standalone: true,
    template: '',
})
class StubEpgListComponent {
    readonly controlledPrograms = input<EpgProgram[] | null>(null);
    readonly controlledArchiveDays = input<number | null>(null);
    readonly archivePlaybackAvailable = input<boolean | null>(null);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly selectedDate = input<string | null>(null);
    readonly showDateNavigator = input(true);
    readonly programActivated = output<EpgProgramActivationEvent>();
    readonly selectedDateChange = output<string>();
}

@Component({
    selector: 'app-live-epg-panel',
    standalone: true,
    template: `
        <div class="live-epg-panel-label">{{ summaryLabelKey() }}</div>
        <div class="live-epg-panel-summary">{{ summary()?.title }}</div>
        <button
            class="live-epg-panel-return"
            type="button"
            [hidden]="!showReturnToLive()"
            (click)="returnToLive.emit()"
        >
            Return to live
        </button>
        <ng-content />
    `,
})
class StubLiveEpgPanelComponent {
    readonly collapsed = input(false);
    readonly summary = input<LiveEpgPanelSummary | null>(null);
    readonly loading = input(false);
    readonly summaryLabelKey = input('EPG.CURRENT_PROGRAM');
    readonly showDateNavigator = input(false);
    readonly selectedDate = input<string | null>(null);
    readonly showReturnToLive = input(false);
    readonly collapsedChange = output<boolean>();
    readonly dateNavigation = output<'next' | 'prev'>();
    readonly returnToLive = output<void>();
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
class StubResizableDirective {}

describe('LiveStreamLayoutComponent', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    let routeQueryParamMap: BehaviorSubject<
        ReturnType<typeof convertToParamMap>
    >;
    const fixedNow = new Date('2026-04-05T12:00:00.000Z');

    const sampleChannel = {
        xtream_id: 101,
        name: 'Channel 101',
        stream_icon: 'channel-101.png',
        tv_archive: 1,
        tv_archive_duration: 3,
    };
    const playlist = {
        id: 'playlist-1',
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };

    const categories = signal([{ category_id: 1, category_name: 'News' }]);
    const categoryItemCounts = signal(new Map<number, number>([[1, 1]]));
    const epgItems = signal<EpgItem[]>([]);
    const currentEpgItem = signal<EpgItem | null>(null);
    const isLoadingEpg = signal(false);
    const selectedTypeContentLoading = signal(false);
    const selectedCategoryId = signal<number | null>(1);
    const selectedContentType = signal<'live' | 'vod' | 'series'>('live');
    const selectedItem = signal<unknown>(sampleChannel);
    const currentPlaylist = signal(playlist);
    const liveStreams = signal<unknown[]>([]);
    const paginatedContent = signal<unknown[]>([]);
    const totalPages = signal(0);
    const page = signal(0);
    const limit = signal(25);

    const xtreamStore = {
        getCategoriesBySelectedType: categories,
        getCategoryItemCounts: categoryItemCounts,
        getPaginatedContent: paginatedContent,
        getTotalPages: totalPages,
        epgItems,
        currentEpgItem,
        isLoadingEpg,
        selectedTypeContentLoading,
        selectedCategoryId,
        selectedContentType,
        selectedItem,
        currentPlaylist,
        liveStreams,
        page,
        limit,
        selectItemsFromSelectedCategory: jest.fn(() => [sampleChannel]),
        constructStreamUrl: jest.fn(() => 'https://example.com/live.ts'),
        openPlayer: jest.fn(),
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
        setPage: jest.fn((nextPage: number) => page.set(nextPage)),
        setLimit: jest.fn((nextLimit: number) => limit.set(nextLimit)),
    };

    let routerEvents: Subject<unknown>;
    let router: { events: Subject<unknown>; navigate: jest.Mock };
    const favoritesService = {
        getFavorites: jest.fn().mockReturnValue(of([])),
    };
    const xtreamUrlService = {
        resolveCatchupUrl: jest
            .fn()
            .mockResolvedValue('https://example.com/timeshift.ts'),
    };
    const portalPlayer = {
        isEmbeddedPlayer: jest.fn().mockReturnValue(true),
    };
    const settingsStore = {
        openStreamOnDoubleClick: signal(false),
    };

    const originalElectron = window.electron;

    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(fixedNow);
        localStorage.removeItem(LIVE_CHANNEL_SORT_STORAGE_KEY);
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
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
        xtreamStore.setPage.mockClear();
        xtreamStore.setLimit.mockClear();
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([
            sampleChannel,
        ]);
        liveStreams.set([]);
        paginatedContent.set([]);
        totalPages.set(0);
        page.set(0);
        limit.set(25);
        favoritesService.getFavorites.mockClear();
        xtreamUrlService.resolveCatchupUrl.mockClear();
        portalPlayer.isEmbeddedPlayer.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);

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
                        EpgListComponent,
                        EpgViewComponent,
                        LiveEpgPanelComponent,
                        GridListComponent,
                        PortalChannelsListComponent,
                        ResizableDirective,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubEpgListComponent,
                        StubEpgViewComponent,
                        StubLiveEpgPanelComponent,
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

        TestBed.inject(LiveLayoutSidebarStateService).setState('expanded');
    });

    afterEach(() => {
        TestBed.inject(LiveLayoutSidebarStateService).setState('expanded');
        fixture.destroy();
        jest.useRealTimers();
        localStorage.removeItem(LIVE_CHANNEL_SORT_STORAGE_KEY);
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
        window.electron = originalElectron;
    });

    it('renders the controlled epg list for electron playback', () => {
        epgItems.set([
            buildEpgItem(
                '1',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);

        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-view')).toBeNull();
    });

    it('hides the EPG panel in browser/PWA playback', () => {
        fixture.destroy();
        window.electron = undefined as unknown as typeof window.electron;

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;

        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-web-player-view')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.epg')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-live-epg-panel')
        ).toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-list')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-view')).toBeNull();
    });

    it('restores the collapsed live EPG panel state for embedded playback', () => {
        fixture.destroy();
        localStorage.setItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY, 'collapsed');

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(component.isLiveEpgPanelCollapsed()).toBe(true);
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                .classList.contains('epg-collapsed')
        ).toBe(true);
    });

    it('persists live EPG panel toggle changes', () => {
        component.onLiveEpgPanelCollapsedChange(true);

        expect(component.isLiveEpgPanelCollapsed()).toBe(true);
        expect(localStorage.getItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY)).toBe(
            'collapsed'
        );

        component.onLiveEpgPanelCollapsedChange(false);

        expect(localStorage.getItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY)).toBe(
            'expanded'
        );
    });

    it('does not render the collapsible panel for external playback', () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-live-epg-panel')
        ).toBeNull();
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                .classList.contains('epg-collapsed')
        ).toBe(false);
    });

    it('shows the channel loading skeleton surface while live content loads without a selected category', () => {
        selectedCategoryId.set(null);
        selectedTypeContentLoading.set(true);

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="portal-channels-list-stub"]'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-portal-empty-state')
        ).toBeNull();
    });

    it('shows live all-items content with the shared grid and header paginator before a category is selected', () => {
        const firstChannel = {
            xtream_id: 301,
            name: 'First Channel',
            category_id: '7',
            added: String(
                Math.floor(Date.parse('2026-04-04T12:00:00Z') / 1000)
            ),
        };
        const secondChannel = {
            xtream_id: 302,
            name: 'Second Channel',
            category_id: '8',
            added: String(
                Math.floor(Date.parse('2026-04-03T12:00:00Z') / 1000)
            ),
        };
        const thirdChannel = {
            xtream_id: 303,
            name: 'Third Channel',
            category_id: '9',
            added: String(
                Math.floor(Date.parse('2026-04-02T12:00:00Z') / 1000)
            ),
        };
        selectedCategoryId.set(null);
        selectedTypeContentLoading.set(false);
        limit.set(25);
        page.set(0);
        totalPages.set(2);
        paginatedContent.set([firstChannel, secondChannel]);
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([
            firstChannel,
            secondChannel,
            thirdChannel,
        ]);

        fixture.detectChanges();

        const grid = fixture.debugElement.query(
            By.directive(StubGridListComponent)
        );
        expect(grid).not.toBeNull();
        expect(grid.componentInstance.items()).toEqual([
            firstChannel,
            secondChannel,
        ]);
        expect(grid.componentInstance.variant()).toBe('logo');
        expect(grid.componentInstance.type()).toBe('live');
        expect(grid.componentInstance.showPaginator()).toBe(false);
        expect(grid.componentInstance.pageIndex()).toBe(0);
        expect(grid.componentInstance.totalPages()).toBe(2);
        expect(grid.componentInstance.limit()).toBe(25);
        expect(grid.componentInstance.pageSizeOptions()).toEqual([
            10, 25, 50, 100,
        ]);
        expect(
            fixture.nativeElement.querySelector('.category-title').textContent
        ).toContain('All Items');
        expect(
            fixture.nativeElement.querySelector('.category-subtitle')
                .textContent
        ).toContain('3 channels');
        expect(
            fixture.nativeElement.querySelector('mat-paginator')
        ).not.toBeNull();
        expect(
            fixture.debugElement.query(
                By.directive(StubPortalChannelsListComponent)
            )
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-portal-empty-state')
        ).toBeNull();
    });

    it('plays a live all-items grid card and selects its category', () => {
        const channel = {
            xtream_id: 301,
            name: 'Grid Channel',
            category_id: '7',
            added: String(
                Math.floor(Date.parse('2026-04-04T12:00:00Z') / 1000)
            ),
        };
        selectedCategoryId.set(null);
        selectedTypeContentLoading.set(false);
        paginatedContent.set([channel]);
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([channel]);

        fixture.detectChanges();

        const grid = fixture.debugElement.query(
            By.directive(StubGridListComponent)
        );
        grid.componentInstance.itemClicked.emit(channel);
        fixture.detectChanges();

        expect(xtreamStore.constructStreamUrl).toHaveBeenCalledWith(channel);
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(7);
        expect(
            fixture.debugElement.query(By.directive(StubWebPlayerViewComponent))
        ).not.toBeNull();
    });

    it('updates live root pagination from the header paginator', () => {
        selectedCategoryId.set(null);
        selectedTypeContentLoading.set(false);
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue(
            Array.from({ length: 80 }, (_, index) => ({
                xtream_id: index + 1,
                name: `Channel ${index + 1}`,
            }))
        );
        paginatedContent.set([]);

        fixture.detectChanges();

        const paginator = fixture.debugElement.query(By.css('mat-paginator'));
        expect(paginator).not.toBeNull();
        paginator.triggerEventHandler('page', {
            pageIndex: 1,
            pageSize: 50,
            length: 80,
            previousPageIndex: 0,
        } satisfies PageEvent);

        expect(xtreamStore.setPage).toHaveBeenCalledWith(1);
        expect(xtreamStore.setLimit).toHaveBeenCalledWith(50);
        expect(router.navigate).toHaveBeenCalledWith([], {
            relativeTo: expect.any(Object),
            queryParams: { page: 2 },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    });

    it('applies the live root page query parameter', () => {
        selectedCategoryId.set(null);
        selectedTypeContentLoading.set(false);

        routeQueryParamMap.next(convertToParamMap({ page: '3' }));
        fixture.detectChanges();

        expect(xtreamStore.setPage).toHaveBeenCalledWith(2);
    });

    it('shows the cross-category live channel list while searching from the live root', () => {
        selectedCategoryId.set(null);
        selectedTypeContentLoading.set(false);
        routeQueryParamMap.next(convertToParamMap({ q: 'world' }));

        fixture.detectChanges();

        const lists = fixture.debugElement.queryAll(
            By.directive(StubPortalChannelsListComponent)
        );
        const list = lists[0];

        expect(list).not.toBeNull();
        expect(lists).toHaveLength(1);
        expect(list.componentInstance.searchTermInput() as string).toBe(
            'world'
        );
        expect(
            fixture.nativeElement.querySelector(
                '.sidebar [data-test-id="portal-channels-list-stub"]'
            )
        ).not.toBeNull();
    });

    it('shows embedded playback after selecting a channel from live root search results', () => {
        const searchResultChannel = {
            ...sampleChannel,
            category_id: '7',
        };
        selectedCategoryId.set(null);
        selectedTypeContentLoading.set(false);
        routeQueryParamMap.next(convertToParamMap({ q: 'world' }));
        fixture.detectChanges();

        const list = fixture.debugElement.query(
            By.directive(StubPortalChannelsListComponent)
        );

        list.componentInstance.playClicked.emit(searchResultChannel);
        fixture.detectChanges();

        expect(xtreamStore.constructStreamUrl).toHaveBeenCalledWith(
            searchResultChannel
        );
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(7);
        expect(
            fixture.debugElement.query(By.directive(StubWebPlayerViewComponent))
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '.sidebar [data-test-id="portal-channels-list-stub"]'
            )
        ).not.toBeNull();
    });

    it('renders the current EPG program in the collapsible panel summary', () => {
        epgItems.set([
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);
        currentEpgItem.set(epgItems()[0]);

        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.live-epg-panel-summary')
                .textContent
        ).toContain('Current Show');
        expect(
            fixture.nativeElement.querySelector('.live-epg-panel-label')
                .textContent
        ).toContain('EPG.CURRENT_PROGRAM');
    });

    it('uses currentEpgItem instead of assuming the first schedule item is current', () => {
        epgItems.set([
            buildEpgItem(
                'past',
                'Past Show',
                '2026-04-05T08:00:00.000Z',
                '2026-04-05T09:00:00.000Z'
            ),
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);
        currentEpgItem.set(epgItems()[1]);

        fixture.detectChanges();

        expect(window.electron?.updateRemoteControlStatus).toHaveBeenCalledWith(
            expect.objectContaining({
                epgTitle: 'Current Show',
            })
        );
    });

    it('does not publish remote-control status when the bridge is incomplete', () => {
        fixture.destroy();
        const updateRemoteControlStatus = jest.fn();
        window.electron = {
            updateRemoteControlStatus,
        } as typeof window.electron;

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();

        expect(updateRemoteControlStatus).not.toHaveBeenCalled();
    });

    it('resolves a catchup url for archived program activation', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        await component.onProgramActivated({
            type: 'timeshift',
            program: {
                start: '2026-04-04T10:00:00.000Z',
                stop: '2026-04-04T11:00:00.000Z',
                channel: 'channel-101',
                title: 'Archived Show',
                desc: null,
                category: null,
                startTimestamp: 1775296800,
                stopTimestamp: 1775300400,
            },
        });

        expect(xtreamUrlService.resolveCatchupUrl).toHaveBeenCalledWith(
            'playlist-1',
            {
                allowedOutputFormats: undefined,
                serverUrl: 'http://demo.example',
                username: 'demo',
                password: 'secret',
            },
            101,
            1775296800,
            1775300400,
            undefined
        );
        expect(xtreamStore.openPlayer).toHaveBeenCalledWith(
            'https://example.com/timeshift.ts',
            'Channel 101 - Archived Show',
            'channel-101.png'
        );
        expect(component.activePlayback()).toEqual(
            expect.objectContaining({
                streamUrl: 'https://example.com/timeshift.ts',
                isLive: false,
            })
        );
    });

    it('shows the active archive program in the live EPG panel summary', async () => {
        const archivedProgram: EpgProgram = {
            start: '2026-04-04T10:00:00.000Z',
            stop: '2026-04-04T11:00:00.000Z',
            channel: 'channel-101',
            title: 'Archived Show',
            desc: null,
            category: null,
            startTimestamp: 1775296800,
            stopTimestamp: 1775300400,
        };
        epgItems.set([
            buildEpgItem(
                'archived',
                'Archived Show',
                archivedProgram.start,
                archivedProgram.stop
            ),
        ]);
        currentEpgItem.set(
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            )
        );

        component.playLive(sampleChannel);
        await component.onProgramActivated({
            type: 'timeshift',
            program: archivedProgram,
        });
        fixture.detectChanges();

        const panel = fixture.debugElement.query(
            By.directive(StubLiveEpgPanelComponent)
        );
        expect(panel.componentInstance.summary()).toEqual(
            expect.objectContaining({
                title: 'Archived Show',
                start: '2026-04-04T10:00:00.000Z',
                stop: '2026-04-04T11:00:00.000Z',
            })
        );
        expect(panel.componentInstance.summaryLabelKey()).toBe(
            'EPG.ARCHIVE_PLAYBACK'
        );
        expect(panel.componentInstance.showReturnToLive()).toBe(true);
        expect(
            fixture.nativeElement.querySelector('.live-epg-panel-summary')
                .textContent
        ).toContain('Archived Show');
        expect(
            fixture.nativeElement.querySelector('.live-epg-panel-summary')
                .textContent
        ).not.toContain('Current Show');
    });

    it('returns archive playback to the selected live stream from the panel action', async () => {
        const archivedProgram: EpgProgram = {
            start: '2026-04-04T10:00:00.000Z',
            stop: '2026-04-04T11:00:00.000Z',
            channel: 'channel-101',
            title: 'Archived Show',
            desc: null,
            category: null,
            startTimestamp: 1775296800,
            stopTimestamp: 1775300400,
        };
        currentEpgItem.set(
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            )
        );

        component.playLive(sampleChannel);
        await component.onProgramActivated({
            type: 'timeshift',
            program: archivedProgram,
        });
        fixture.detectChanges();

        const panel = fixture.debugElement.query(
            By.directive(StubLiveEpgPanelComponent)
        );
        panel.componentInstance.returnToLive.emit();
        fixture.detectChanges();

        expect(component.activeCatchupProgram()).toBeNull();
        expect(component.activePlayback()).toEqual(
            expect.objectContaining({
                streamUrl: 'https://example.com/live.ts',
                isLive: true,
            })
        );
        expect(panel.componentInstance.summary()?.title).toBe('Current Show');
        expect(panel.componentInstance.summaryLabelKey()).toBe(
            'EPG.CURRENT_PROGRAM'
        );
        expect(panel.componentInstance.showReturnToLive()).toBe(false);
    });

    it('publishes the active archive program in remote-control status', async () => {
        const archivedProgram: EpgProgram = {
            start: '2026-04-04T10:00:00.000Z',
            stop: '2026-04-04T11:00:00.000Z',
            channel: 'channel-101',
            title: 'Archived Show',
            desc: null,
            category: null,
            startTimestamp: 1775296800,
            stopTimestamp: 1775300400,
        };
        currentEpgItem.set(
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            )
        );
        const updateRemoteControlStatus = window.electron
            ?.updateRemoteControlStatus as jest.Mock;

        component.playLive(sampleChannel);
        fixture.detectChanges();
        updateRemoteControlStatus.mockClear();

        await component.onProgramActivated({
            type: 'timeshift',
            program: archivedProgram,
        });
        fixture.detectChanges();

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                epgTitle: 'Archived Show',
                epgStart: '2026-04-04T10:00:00.000Z',
                epgEnd: '2026-04-04T11:00:00.000Z',
            })
        );
    });

    it('passes the active catchup program to the EPG list until live playback resumes', async () => {
        const archivedProgram: EpgProgram = {
            start: '2026-04-04T10:00:00.000Z',
            stop: '2026-04-04T11:00:00.000Z',
            channel: 'channel-101',
            title: 'Archived Show',
            desc: null,
            category: null,
            startTimestamp: 1775296800,
            stopTimestamp: 1775300400,
        };
        epgItems.set([
            buildEpgItem(
                '1',
                'Archived Show',
                archivedProgram.start,
                archivedProgram.stop
            ),
        ]);

        await component.onProgramActivated({
            type: 'timeshift',
            program: archivedProgram,
        });
        fixture.detectChanges();

        let epgList = fixture.debugElement.query(
            By.directive(StubEpgListComponent)
        );
        expect(epgList.componentInstance.activeProgram()).toEqual(
            archivedProgram
        );

        component.playLive(sampleChannel);
        fixture.detectChanges();

        epgList = fixture.debugElement.query(By.directive(StubEpgListComponent));
        expect(epgList.componentInstance.activeProgram()).toBeNull();
    });

    it('starts external playback from remote channel navigation when double-click opening is enabled', () => {
        const nextChannel = {
            ...sampleChannel,
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

    it('shows an archive-unavailable notice when past programs exist but archive playback is unavailable', () => {
        const nonArchiveChannel = {
            ...sampleChannel,
            tv_archive: 0,
            tv_archive_duration: null,
        };
        selectedItem.set(nonArchiveChannel);
        epgItems.set([
            buildEpgItem(
                'past',
                'Past Show',
                '2026-04-05T09:00:00.000Z',
                '2026-04-05T10:00:00.000Z'
            ),
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);

        component.playLive(nonArchiveChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.archive-unavailable-banner')
        ).not.toBeNull();
    });

    it('hides the archive-unavailable notice when archive playback is available', () => {
        selectedItem.set(sampleChannel);
        epgItems.set([
            buildEpgItem(
                'past',
                'Past Show',
                '2026-04-05T09:00:00.000Z',
                '2026-04-05T10:00:00.000Z'
            ),
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);

        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.archive-unavailable-banner')
        ).toBeNull();
    });

    it('shows the floating restore button when the sidebar is collapsed even without a selected category', () => {
        selectedCategoryId.set(null);
        TestBed.inject(LiveLayoutSidebarStateService).setState('collapsed');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.sidebar-restore')
        ).not.toBeNull();
    });

    it('hides the floating restore button when the sidebar is expanded', () => {
        selectedCategoryId.set(1);
        TestBed.inject(LiveLayoutSidebarStateService).setState('expanded');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.sidebar-restore')
        ).toBeNull();
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

    it('hides the archive-unavailable notice when there are no past programs yet', () => {
        const nonArchiveChannel = {
            ...sampleChannel,
            tv_archive: 0,
            tv_archive_duration: null,
        };
        selectedItem.set(nonArchiveChannel);
        epgItems.set([
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
            buildEpgItem(
                'future',
                'Future Show',
                '2026-04-05T12:30:00.000Z',
                '2026-04-05T13:30:00.000Z'
            ),
        ]);

        component.playLive(nonArchiveChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.archive-unavailable-banner')
        ).toBeNull();
    });
});

function buildEpgItem(
    id: string,
    title: string,
    start: string,
    stop: string
): EpgItem {
    return {
        id,
        epg_id: `epg-${id}`,
        title,
        description: '',
        lang: 'en',
        start,
        stop,
        end: stop,
        channel_id: 'channel-101',
        start_timestamp: String(Math.floor(Date.parse(start) / 1000)),
        stop_timestamp: String(Math.floor(Date.parse(stop) / 1000)),
    };
}
