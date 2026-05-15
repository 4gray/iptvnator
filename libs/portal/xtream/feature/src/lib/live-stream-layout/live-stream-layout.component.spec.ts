import { Directive, Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MockPipe } from 'ng-mocks';
import { TranslatePipe } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
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
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { SettingsStore } from '@iptvnator/services';

const LIVE_CHANNEL_SORT_STORAGE_KEY = 'xtream-live-channel-sort-mode';

@Component({
    selector: 'app-portal-channels-list',
    standalone: true,
    template: '<div data-test-id="portal-channels-list-stub"></div>',
})
class StubPortalChannelsListComponent {
    readonly sortMode = input<'server' | 'name-asc' | 'name-desc'>('server');
    readonly searchTermInput = input('');
    readonly playClicked = output<unknown>();
    readonly playbackRequested = output<unknown>();
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
    readonly selectedDate = input<string | null>(null);
    readonly showDateNavigator = input(true);
    readonly programActivated = output<EpgProgramActivationEvent>();
    readonly selectedDateChange = output<string>();
}

@Component({
    selector: 'app-live-epg-panel',
    standalone: true,
    template: `
        <div class="live-epg-panel-summary">{{ summary()?.title }}</div>
        <ng-content />
    `,
})
class StubLiveEpgPanelComponent {
    readonly collapsed = input(false);
    readonly summary = input<LiveEpgPanelSummary | null>(null);
    readonly loading = input(false);
    readonly showDateNavigator = input(false);
    readonly selectedDate = input<string | null>(null);
    readonly collapsedChange = output<boolean>();
    readonly dateNavigation = output<'next' | 'prev'>();
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

    const xtreamStore = {
        getCategoriesBySelectedType: categories,
        getCategoryItemCounts: categoryItemCounts,
        epgItems,
        currentEpgItem,
        isLoadingEpg,
        selectedTypeContentLoading,
        selectedCategoryId,
        selectedContentType,
        selectedItem,
        currentPlaylist,
        selectItemsFromSelectedCategory: jest.fn(() => [sampleChannel]),
        constructStreamUrl: jest.fn(() => 'https://example.com/live.ts'),
        openPlayer: jest.fn(),
    };
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
        } as typeof window.electron;

        xtreamStore.constructStreamUrl.mockClear();
        xtreamStore.openPlayer.mockClear();
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([
            sampleChannel,
        ]);
        favoritesService.getFavorites.mockClear();
        xtreamUrlService.resolveCatchupUrl.mockClear();
        portalPlayer.isEmbeddedPlayer.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);

        epgItems.set([]);
        currentEpgItem.set(null);
        isLoadingEpg.set(false);
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
                { provide: XtreamStore, useValue: xtreamStore },
                { provide: FavoritesService, useValue: favoritesService },
                { provide: XtreamUrlService, useValue: xtreamUrlService },
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
        selectedCategoryId.set(null);
        selectedTypeContentLoading.set(false);
        routeQueryParamMap.next(convertToParamMap({ q: 'world' }));
        fixture.detectChanges();

        const list = fixture.debugElement.query(
            By.directive(StubPortalChannelsListComponent)
        );

        list.componentInstance.playClicked.emit(sampleChannel);
        fixture.detectChanges();

        expect(xtreamStore.constructStreamUrl).toHaveBeenCalledWith(
            sampleChannel
        );
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
