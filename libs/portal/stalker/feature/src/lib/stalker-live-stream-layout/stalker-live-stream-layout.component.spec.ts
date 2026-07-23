import {
    Component,
    Directive,
    EventEmitter,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
import {
    LIVE_EPG_PANEL_STATE_STORAGE_KEY,
    PORTAL_PLAYER,
    ResizableDirective,
} from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    EpgListViewComponent,
    EpgTimelineComponent,
} from '@iptvnator/ui/epg';
import { AudioPlayerComponent } from '@iptvnator/ui/playback';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ChannelListItemComponent } from '@iptvnator/ui/components';
import { MockPipe } from 'ng-mocks';
import { of } from 'rxjs';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { MatDialog } from '@angular/material/dialog';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';

@Component({
    selector: 'app-channel-list-item',
    standalone: true,
    template: '',
})
class StubChannelListItemComponent {
    readonly name = input('');
    readonly logo = input<string | null | undefined>(null);
    readonly selected = input(false);
    readonly epgProgram = input<unknown>(null);
    readonly progressPercentage = input(0);
    readonly showFavoriteButton = input(false);
    readonly showProgramInfoButton = input(false);
    readonly showDetailsContextMenu = input(false);
    readonly isFavorite = input(false);
    readonly clicked = output<void>();
    readonly activated = output<void>();
    readonly favoriteToggled = output<void>();
    readonly contextMenuRequested = output<MouseEvent>();
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
    selector: 'app-audio-player',
    standalone: true,
    template: '',
})
class StubAudioPlayerComponent {
    readonly url = input.required<string>();
    readonly icon = input('');
    readonly channelName = input('');
    readonly dispatchAdjacentChannelAction = input(true);
    readonly channelSwitchRequested = output<'next' | 'previous'>();
}

// Matches both live-panel selectors so the host's timeline ↔ list swap can be
// asserted by tag name; both branches share the identical contract.
@Component({
    selector: 'app-epg-timeline, app-epg-list-view',
    standalone: true,
    template: `
        <div class="live-epg-panel-summary">{{ summary()?.title }}</div>
    `,
})
class StubEpgTimelineComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly sourceLabel = input('');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDays = input(0);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(false);
    readonly loading = input(false);
    readonly emptyReason = input<string>('none');
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    readonly summary = input<{ title?: string } | null>(null);
    readonly summaryLabelKey = input('');
    readonly selectedDateChange = output<string>();
    readonly programActivated = output<EpgProgram>();
    readonly returnToLive = output<void>();
    readonly openEpgSettings = output<void>();
    readonly retry = output<void>();
    readonly collapsedChange = output<boolean>();
}

@Component({
    selector: 'app-portal-empty-state',
    standalone: true,
    template: '',
})
class StubPortalEmptyStateComponent {
    readonly icon = input('');
    readonly message = input('');
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
class StubResizableDirective {}

describe('StalkerLiveStreamLayoutComponent', () => {
    let fixture: ComponentFixture<StalkerLiveStreamLayoutComponent>;
    let component: StalkerLiveStreamLayoutComponent;
    let fetchChannelEpg: jest.Mock;
    let ensureBulkItvEpg: jest.Mock;
    let resolveItvPlayback: jest.Mock;
    let resolveRadioPlayback: jest.Mock;

    const playlist = signal({
        _id: 'playlist-1',
        title: 'Demo Stalker',
    });
    const selectedCategoryId = signal<string | null>('1001');
    const searchPhrase = signal('');
    const defaultItvChannels = () => [
        {
            id: '10001',
            cmd: 'ffrt4://itv/10001',
            name: 'Alpha TV',
            o_name: 'Alpha TV',
            logo: 'alpha.png',
        },
        {
            id: '10002',
            cmd: 'ffrt4://itv/10002',
            name: 'Beta TV',
            o_name: 'Beta TV',
            logo: 'beta.png',
        },
    ];
    const itvChannels = signal(defaultItvChannels());
    const radioChannels = signal([
        {
            id: 'radio-1',
            cmd: 'ifm https://stream.example/jazz.mp3',
            name: 'Jazz FM',
            o_name: 'Jazz FM',
            logo: 'jazz.png',
        },
        {
            id: 'radio-2',
            cmd: 'ifm https://stream.example/news.mp3',
            name: 'News Radio',
            o_name: 'News Radio',
            logo: 'news-radio.png',
        },
    ]);
    const selectedItvId = signal<string | undefined>('10001');
    const selectedItem = signal<{
        id: string;
        cmd: string;
        name: string;
        o_name: string;
        logo: string;
    } | null>(itvChannels()[0]);
    const selectedItvEpgPrograms = signal<EpgProgram[]>([]);
    const bulkItvEpgByChannel = signal<Record<string, EpgProgram[]>>({});
    const bulkItvEpgLoaded = signal(false);
    const bulkItvEpgPlaylistId = signal<string | null>(null);
    const bulkItvEpgPeriodHours = signal<number | null>(null);
    const isLoadingBulkItvEpg = signal(false);
    const hasMoreChannels = signal(false);
    const page = signal(0);
    const itvFullListActive = signal(false);
    const itvFullListLoading = signal(false);
    const itvFullListProgress = signal<{
        loaded: number;
        total: number;
    } | null>(null);
    const itvFullChannelList = signal<
        ReturnType<typeof defaultItvChannels>
    >([]);
    const itvSelectedCategoryFromCache = signal(false);
    const isPaginatedContentLoading = signal(false);

    const stalkerStore = {
        getSelectedCategoryName: signal('News'),
        itvChannels,
        radioChannels,
        searchPhrase,
        hasMoreChannels,
        itvFullListActive,
        itvFullListLoading,
        itvFullListProgress,
        itvFullChannelList,
        itvSelectedCategoryFromCache,
        isPaginatedContentLoading,
        preloadItvChannels: jest.fn(),
        refreshItvChannels: jest.fn().mockResolvedValue(undefined),
        selectedItvId,
        currentPlaylist: playlist,
        selectedItvEpgPrograms,
        bulkItvEpgByChannel,
        bulkItvEpgLoaded,
        bulkItvEpgPlaylistId,
        bulkItvEpgPeriodHours,
        isLoadingBulkItvEpg,
        selectedCategoryId,
        selectedItem,
        selectedContentType: signal<'itv' | 'vod' | 'series' | 'radio'>('itv'),
        page,
        setItvChannels: jest.fn(),
        setRadioChannels: jest.fn(),
        setPage: jest.fn(),
        setSelectedItem: jest.fn((item) => {
            selectedItem.set(item);
            selectedItvId.set(String(item.id));
            selectedItvEpgPrograms.set(
                bulkItvEpgByChannel()[String(item.id)] ?? []
            );
        }),
        resolveItvPlayback: jest.fn(),
        resolveRadioPlayback: jest.fn(),
        fetchChannelEpg: jest.fn(),
        ensureBulkItvEpg: jest.fn(),
        applyMappedItvEpg: jest.fn().mockResolvedValue(undefined),
        clearBulkItvEpgCache: jest.fn(() => {
            bulkItvEpgByChannel.set({});
            bulkItvEpgLoaded.set(false);
            bulkItvEpgPlaylistId.set(null);
            bulkItvEpgPeriodHours.set(null);
            selectedItvEpgPrograms.set([]);
        }),
        addToFavorites: jest.fn(),
        removeFromFavorites: jest.fn(),
    };

    const playlistService = {
        getPortalFavorites: jest.fn(() => of([])),
    };
    const portalPlayer = {
        isEmbeddedPlayer: jest.fn(() => true),
        openResolvedPlayback: jest.fn(),
    };
    const settingsStore = {
        openStreamOnDoubleClick: signal(false),
        resolvedEpgViewMode: signal<'timeline' | 'list'>('timeline'),
    };
    const originalElectron = window.electron;

    beforeEach(async () => {
        // The store mock is module-scoped: reset so a failed test can't leak
        // 'list' into siblings.
        settingsStore.resolvedEpgViewMode.set('timeline');
        window.electron = {
            platform: 'darwin',
            updateRemoteControlStatus: jest.fn(),
            onChannelChange: jest.fn(() => jest.fn()),
            onRemoteControlCommand: jest.fn(() => jest.fn()),
        } as typeof window.electron;

        fetchChannelEpg = stalkerStore.fetchChannelEpg;
        ensureBulkItvEpg = stalkerStore.ensureBulkItvEpg;
        resolveItvPlayback = stalkerStore.resolveItvPlayback;
        resolveRadioPlayback = stalkerStore.resolveRadioPlayback;

        itvChannels.set(defaultItvChannels());
        selectedCategoryId.set('1001');
        searchPhrase.set('');
        stalkerStore.selectedContentType.set('itv');
        selectedItvId.set('10001');
        selectedItem.set(itvChannels()[0]);
        selectedItvEpgPrograms.set([]);
        bulkItvEpgByChannel.set({});
        bulkItvEpgLoaded.set(false);
        bulkItvEpgPlaylistId.set(null);
        bulkItvEpgPeriodHours.set(null);
        isLoadingBulkItvEpg.set(false);
        hasMoreChannels.set(false);
        page.set(0);
        itvFullListActive.set(false);
        itvFullListLoading.set(false);
        itvFullListProgress.set(null);
        itvFullChannelList.set([]);
        itvSelectedCategoryFromCache.set(false);
        isPaginatedContentLoading.set(false);
        stalkerStore.preloadItvChannels.mockClear();
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        settingsStore.openStreamOnDoubleClick.set(false);

        resolveItvPlayback.mockReset();
        resolveItvPlayback.mockResolvedValue({
            streamUrl: 'https://example.com/alpha.m3u8',
        });
        resolveRadioPlayback.mockReset();
        resolveRadioPlayback.mockResolvedValue({
            streamUrl: 'https://stream.example/jazz.mp3',
            title: 'Jazz FM',
            thumbnail: 'jazz.png',
        });
        portalPlayer.isEmbeddedPlayer.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        portalPlayer.openResolvedPlayback.mockClear();
        fetchChannelEpg.mockReset();
        fetchChannelEpg.mockResolvedValue([]);
        ensureBulkItvEpg.mockReset();
        ensureBulkItvEpg.mockImplementation(async () => {
            const bulkPrograms = {
                '10001': [buildProgram('10001', 'Current Show')],
                '10002': [buildProgram('10002', 'Next Channel Show')],
            };
            bulkItvEpgByChannel.set(bulkPrograms);
            bulkItvEpgLoaded.set(true);
            bulkItvEpgPlaylistId.set('playlist-1');
            bulkItvEpgPeriodHours.set(168);
            selectedItvEpgPrograms.set(
                bulkPrograms[selectedItvId() ?? ''] ?? []
            );
        });
        stalkerStore.setItvChannels.mockClear();
        stalkerStore.setRadioChannels.mockClear();
        stalkerStore.setPage.mockReset();
        stalkerStore.setPage.mockImplementation((nextPage: number) => {
            if (page() === nextPage) {
                return;
            }

            page.set(nextPage);
        });
        stalkerStore.setSelectedItem.mockClear();
        stalkerStore.clearBulkItvEpgCache.mockClear();

        await TestBed.configureTestingModule({
            imports: [StalkerLiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                { provide: StalkerStore, useValue: stalkerStore },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                        get isElectron() {
                            return Boolean(window.electron);
                        },
                        get supportsEpgMapping() {
                            return false;
                        },
                    },
                },
                { provide: PlaylistsService, useValue: playlistService },
                { provide: SettingsStore, useValue: settingsStore },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((value: string) => value),
                        // The real TranslatePipe (used by child components
                        // that aren't stubbed) needs these members too.
                        get: jest.fn((value: string) => of(value)),
                        stream: jest.fn((value: string) => of(value)),
                        onTranslationChange: new EventEmitter(),
                        onLangChange: new EventEmitter(),
                        onDefaultLangChange: new EventEmitter(),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: MatDialog,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        supportsEpgMapping: false,
                        getEpgMapping: jest.fn().mockResolvedValue(null),
                        getEpgMappingsBatch: jest
                            .fn()
                            .mockResolvedValue(null),
                    },
                },
            ],
        })
            .overrideComponent(StalkerLiveStreamLayoutComponent, {
                remove: {
                    imports: [
                        ChannelListItemComponent,
                        AudioPlayerComponent,
                        EpgListViewComponent,
                        EpgTimelineComponent,
                        PortalEmptyStateComponent,
                        ResizableDirective,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubChannelListItemComponent,
                        StubAudioPlayerComponent,
                        StubEpgTimelineComponent,
                        StubPortalEmptyStateComponent,
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

        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture?.destroy();
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        window.electron = originalElectron;
    });

    it('renders the controlled epg list and removes the load-more button', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.load-more-epg')
        ).toBeNull();
    });

    it('swaps the timeline for the list view when epgViewMode is "list"', () => {
        settingsStore.resolvedEpgViewMode.set('list');

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-epg-list-view')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).toBeNull();
        // Taller inline panel for the list view (see _portal-layout.scss).
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                ?.classList.contains('epg--list')
        ).toBe(true);

        settingsStore.resolvedEpgViewMode.set('timeline'); // restore for sibling tests
    });

    it('does not request or render EPG in browser/PWA playback', async () => {
        fixture.destroy();
        window.electron = undefined as unknown as typeof window.electron;

        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(ensureBulkItvEpg).not.toHaveBeenCalled();
        expect(fetchChannelEpg).not.toHaveBeenCalled();
        expect(
            fixture.nativeElement.querySelector('app-web-player-view')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.epg')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-timeline')).toBeNull();
    });

    it('restores the collapsed live EPG panel state after embedded playback starts', async () => {
        fixture.destroy();
        localStorage.setItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY, 'collapsed');

        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;
        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.isLiveEpgPanelCollapsed()).toBe(true);
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                .classList.contains('epg-collapsed')
        ).toBe(true);

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;
        expect(timeline.collapsed()).toBe(true);
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

    it('does not collapse the timeline for external playback', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;
        expect(timeline.collapsed()).toBe(false);
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                .classList.contains('epg-collapsed')
        ).toBe(false);
    });

    it('reuses a pending playback resolution during double-click activation', async () => {
        settingsStore.openStreamOnDoubleClick.set(true);
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        let resolvePlayback!: (value: { streamUrl: string }) => void;
        resolveItvPlayback.mockReturnValue(
            new Promise((resolve) => {
                resolvePlayback = resolve;
            })
        );

        const firstClick = component.playChannel(itvChannels()[0], false);
        const secondClick = component.playChannel(itvChannels()[0], false);
        const doubleClick = component.playChannel(itvChannels()[0], true);

        expect(resolveItvPlayback).toHaveBeenCalledTimes(1);

        resolvePlayback({
            streamUrl: 'https://example.com/alpha.m3u8',
        });
        await Promise.all([firstClick, secondClick, doubleClick]);

        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledTimes(1);
        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            { streamUrl: 'https://example.com/alpha.m3u8' },
            true
        );
    });

    it('does not attach a dangling finally cleanup to failed playback resolution', async () => {
        const playbackError = new Error('nothing_to_play');
        const playbackPromise = Promise.reject(playbackError);
        const finallySpy = jest.spyOn(playbackPromise, 'finally');
        resolveItvPlayback.mockReturnValue(playbackPromise);

        await component.playChannel(itvChannels()[0]);

        expect(finallySpy).not.toHaveBeenCalled();
    });

    it('does not publish remote-control status when the bridge is incomplete', () => {
        fixture.destroy();
        const updateRemoteControlStatus = jest.fn();
        window.electron = {
            updateRemoteControlStatus,
        } as typeof window.electron;

        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();

        expect(updateRemoteControlStatus).not.toHaveBeenCalled();
    });

    it('starts external playback from remote channel navigation when double-click opening is enabled', async () => {
        settingsStore.openStreamOnDoubleClick.set(true);
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
        selectedItem.set(itvChannels()[0]);
        selectedItvId.set('10001');

        (
            component as unknown as {
                handleRemoteChannelChange(direction: 'up' | 'down'): void;
            }
        ).handleRemoteChannelChange('down');
        await fixture.whenStable();

        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            { streamUrl: 'https://example.com/alpha.m3u8' },
            true
        );
    });

    it('starts external playback from remote number selection when double-click opening is enabled', async () => {
        settingsStore.openStreamOnDoubleClick.set(true);
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        (
            component as unknown as {
                handleRemoteControlCommand(command: {
                    type: 'channel-select-number';
                    number: number;
                }): void;
            }
        ).handleRemoteControlCommand({
            type: 'channel-select-number',
            number: 2,
        });
        await fixture.whenStable();

        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            { streamUrl: 'https://example.com/alpha.m3u8' },
            true
        );
    });

    it('provides the current EPG program to the timeline collapsed summary', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;
        expect(timeline.summary()?.title).toBe('Current Show');
    });

    it('does not reset live channels when loading the next lazy page', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise<void>((resolve) => setTimeout(resolve, 120));

        page.set(0);
        hasMoreChannels.set(true);
        stalkerStore.setItvChannels.mockClear();
        stalkerStore.setPage.mockClear();

        component.loadMore();
        await fixture.whenStable();

        expect(page()).toBe(1);
        expect(stalkerStore.setPage).toHaveBeenCalledWith(1);
        expect(stalkerStore.setItvChannels).not.toHaveBeenCalled();
    });

    it('windows the rendered list in full-list mode while search covers everything', () => {
        const initialChannels = itvChannels();
        try {
            const full = Array.from({ length: 250 }, (_, index) => ({
                id: `ch-${index}`,
                cmd: `ffrt4://itv/${index}`,
                name: index === 249 ? 'Needle TV' : `Channel ${index}`,
                o_name: index === 249 ? 'Needle TV' : `Channel ${index}`,
                logo: '',
            }));
            itvFullListActive.set(true);
            itvSelectedCategoryFromCache.set(true);
            itvChannels.set(full);
            itvFullChannelList.set(full);
            fixture.detectChanges();

            // Only the first render window hits the DOM…
            expect(component.visibleChannels()).toHaveLength(100);
            // …but the header count reflects the whole list.
            expect(component.totalChannelCount()).toBe(250);
            expect(component.hasMoreItems()).toBe(true);

            stalkerStore.setPage.mockClear();
            component.loadMore();

            // Scrolling extends the window from memory without portal paging.
            expect(component.visibleChannels()).toHaveLength(200);
            expect(stalkerStore.setPage).not.toHaveBeenCalled();

            // Regression: search matches channels far beyond the first page.
            searchPhrase.set('needle');
            fixture.detectChanges();
            expect(
                component.visibleChannels().map((channel) => channel.name)
            ).toEqual(['Needle TV']);
        } finally {
            itvChannels.set(initialChannels);
        }
    });

    it('searches the whole portal (all categories) in full-list mode, not just the current category', () => {
        // The current category (itvChannels) has only 'Alpha TV'/'Beta TV', but
        // the portal's full list contains a News channel in another genre.
        itvFullListActive.set(true);
        itvFullChannelList.set([
            ...defaultItvChannels(),
            {
                id: '55',
                cmd: 'ffrt4://itv/55',
                name: 'CNN International',
                o_name: 'CNN International',
                logo: '',
            },
        ]);
        searchPhrase.set('cnn');
        fixture.detectChanges();

        expect(
            component.filteredChannels().map((channel) => channel.name)
        ).toEqual(['CNN International']);
    });

    it('includes paged censored-category channels in full-list search results', () => {
        // The adult category's channels come from the legacy paged flow and
        // are intentionally absent from the full-list cache — searching for a
        // currently visible channel must still find it (merged source).
        itvFullListActive.set(true);
        itvSelectedCategoryFromCache.set(false);
        itvChannels.set([
            {
                id: 'adult-1',
                cmd: 'ffrt4://itv/adult-1',
                name: 'Erox HD',
                o_name: 'Erox HD',
                logo: '',
            },
        ]);
        itvFullChannelList.set(defaultItvChannels());
        searchPhrase.set('erox');
        fixture.detectChanges();

        expect(
            component.filteredChannels().map((channel) => channel.name)
        ).toEqual(['Erox HD']);

        // And the cached portal-wide channels remain searchable too.
        searchPhrase.set('alpha');
        fixture.detectChanges();
        expect(
            component.filteredChannels().map((channel) => channel.name)
        ).toEqual(['Alpha TV']);
    });

    it('grows the render window to include a channel selected beyond it (remote/numeric nav)', async () => {
        const full = Array.from({ length: 250 }, (_, index) => ({
            id: `ch-${index}`,
            cmd: `ffrt4://itv/${index}`,
            name: `Channel ${index}`,
            o_name: `Channel ${index}`,
            logo: '',
        }));
        itvFullListActive.set(true);
        itvSelectedCategoryFromCache.set(true);
        itvChannels.set(full);
        itvFullChannelList.set(full);
        fixture.detectChanges();

        expect(component.visibleChannels()).toHaveLength(100);

        // Selecting channel index 150 (outside the 100-item window) must grow
        // the window so it is rendered and can be highlighted/scrolled to.
        await component.playChannel(full[150], false);
        fixture.detectChanges();

        expect(component.visibleChannels().length).toBeGreaterThan(150);
        expect(
            component
                .visibleChannels()
                .some((channel) => channel.id === 'ch-150')
        ).toBe(true);
    });

    it('does not clear cached channels when switching category in full-list mode', async () => {
        // Regression: the category-change reset effect used to setItvChannels([])
        // unconditionally, clobbering the list the content loader had just
        // served synchronously from the full-list cache — leaving the sidebar
        // stuck on an infinite skeleton for every category after the first.
        itvFullListActive.set(true);
        itvSelectedCategoryFromCache.set(true);
        fixture.detectChanges();
        await fixture.whenStable();

        stalkerStore.setItvChannels.mockClear();
        selectedCategoryId.set('42');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(stalkerStore.setItvChannels).not.toHaveBeenCalled();
    });

    it('still clears channels on category change when the full list is not active', async () => {
        itvFullListActive.set(false);
        fixture.detectChanges();
        await fixture.whenStable();

        stalkerStore.setItvChannels.mockClear();
        selectedCategoryId.set('99');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(stalkerStore.setItvChannels).toHaveBeenCalledWith([]);
    });

    it('shows an empty state (not a skeleton) for a loaded but empty category', () => {
        // Full list is loaded, nothing is loading, and the selected category
        // filters down to zero channels — this must read as "empty", not "stuck".
        itvFullListActive.set(true);
        itvFullListLoading.set(false);
        isPaginatedContentLoading.set(false);
        itvChannels.set([]);
        searchPhrase.set('');
        fixture.detectChanges();

        expect(component.isInitialChannelsLoading()).toBe(false);
        expect(component.isCategoryEmpty()).toBe(true);
        expect(
            fixture.nativeElement.querySelector('app-channel-list-skeleton')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '.empty-search-state app-portal-empty-state'
            )
        ).toBeTruthy();
    });

    it('shows the skeleton only while a full-list load is genuinely in flight', () => {
        itvChannels.set([]);
        searchPhrase.set('');
        itvFullListActive.set(false);
        isPaginatedContentLoading.set(false);

        itvFullListLoading.set(true);
        fixture.detectChanges();
        expect(component.isInitialChannelsLoading()).toBe(true);

        itvFullListLoading.set(false);
        fixture.detectChanges();
        expect(component.isInitialChannelsLoading()).toBe(false);
    });

    it('shows the skeleton while the legacy paged fetch is loading', () => {
        itvChannels.set([]);
        searchPhrase.set('');
        itvFullListActive.set(false);
        itvFullListLoading.set(false);

        isPaginatedContentLoading.set(true);
        fixture.detectChanges();
        expect(component.isInitialChannelsLoading()).toBe(true);
    });

    it('keeps portal pagination for a censored category absent from the cache', async () => {
        // Full list IS active, but the selected (adult) genre has no cached
        // channels — infinite scroll must request the next portal page instead
        // of only growing the client-side render window.
        itvFullListActive.set(true);
        itvSelectedCategoryFromCache.set(false);
        hasMoreChannels.set(true);
        fixture.detectChanges();
        await fixture.whenStable();

        page.set(0);
        stalkerStore.setPage.mockClear();
        component.loadMore();

        expect(stalkerStore.setPage).toHaveBeenCalledWith(1);
    });

    it('preloads the full channel list as soon as the Live TV section is entered', () => {
        // No category selected — the preload must not wait for a category click.
        selectedCategoryId.set(null);
        fixture.detectChanges();

        expect(stalkerStore.preloadItvChannels).toHaveBeenCalled();
    });

    it('shows the all-channels grid instead of the placeholder when the full list is available', () => {
        selectedCategoryId.set(null);
        selectedItem.set(null);
        itvFullListActive.set(true);
        itvFullChannelList.set(defaultItvChannels());
        fixture.detectChanges();

        const grid = fixture.nativeElement.querySelector(
            'app-stalker-itv-all-items'
        );
        expect(grid).toBeTruthy();
        expect(grid.querySelectorAll('mat-card')).toHaveLength(2);
        expect(
            fixture.nativeElement.querySelector('app-portal-empty-state')
        ).toBeNull();
    });

    it('keeps the select-a-category placeholder on portals without a usable full list', () => {
        selectedCategoryId.set(null);
        selectedItem.set(null);
        itvFullListActive.set(false);
        itvFullListLoading.set(false);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-stalker-itv-all-items')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-portal-empty-state')
        ).toBeTruthy();
    });

    it('shows the refresh button in full-list mode and delegates to the store', () => {
        itvFullListActive.set(true);
        fixture.detectChanges();

        const buttons = Array.from(
            fixture.nativeElement.querySelectorAll(
                '.category-content-header button'
            )
        ) as HTMLButtonElement[];
        const refreshButton = buttons.find((button) =>
            button.textContent?.includes('refresh')
        );

        expect(refreshButton).toBeTruthy();
        refreshButton?.click();
        expect(stalkerStore.refreshItvChannels).toHaveBeenCalled();
    });

    it('persists the channels sidebar width under a dedicated storage key', () => {
        // The shell context panel (category sidebar) is visible at the same
        // time as this sidebar and persists its width under the shared
        // "sidebar-width" key. Reusing that key here makes the two panels
        // overwrite each other's stored width across reloads.
        fixture.detectChanges();

        const sidebar: HTMLElement =
            fixture.nativeElement.querySelector('.sidebar');
        expect(sidebar.getAttribute('storageKey')).toBe(
            'live-channels-sidebar-width'
        );
    });

    async function settleEagerEpg(): Promise<void> {
        for (let i = 0; i < 5; i += 1) {
            fixture.detectChanges();
            await fixture.whenStable();
            await new Promise<void>((resolve) => setTimeout(resolve));
        }
        fixture.detectChanges();
    }

    it('loads bulk EPG and shows row previews on category entry, before any playback', async () => {
        await settleEagerEpg();

        // The list EPG previews appear as soon as the category's channels are
        // shown — the user no longer has to play a channel first.
        expect(ensureBulkItvEpg).toHaveBeenCalledWith(168);
        expect(component.epgPreviewPrograms.get('10001')?.title).toBe(
            'Current Show'
        );
        expect(component.epgPreviewPrograms.get('10002')?.title).toBe(
            'Next Channel Show'
        );
        // The per-channel fallback is reserved for the playing channel.
        expect(fetchChannelEpg).not.toHaveBeenCalled();
    });

    it('does not load bulk EPG for radio (no EPG data)', async () => {
        stalkerStore.selectedContentType.set('radio');
        selectedCategoryId.set('radio-all');
        selectedItem.set(null);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(ensureBulkItvEpg).not.toHaveBeenCalled();
    });

    it('derives row previews from cached bulk epg after first playback', async () => {
        fixture.detectChanges();

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.epgPreviewPrograms.get('10001')?.title).toBe(
            'Current Show'
        );
        expect(component.epgPreviewPrograms.get('10002')?.title).toBe(
            'Next Channel Show'
        );
        expect(fetchChannelEpg).not.toHaveBeenCalled();
    });

    it('does not re-fetch bulk EPG when switching channels once it is loaded', async () => {
        await settleEagerEpg();
        // Bulk EPG has loaded (eagerly, on entry).
        ensureBulkItvEpg.mockClear();

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        await component.playChannel(itvChannels()[1]);
        await fixture.whenStable();

        // Playing/switching channels reuses the cached bulk EPG.
        expect(ensureBulkItvEpg).not.toHaveBeenCalled();
    });

    it('renders inline audio playback and no EPG for radio stations', async () => {
        stalkerStore.selectedContentType.set('radio');
        selectedCategoryId.set('radio-all');
        selectedItem.set(null);
        selectedItvId.set(undefined);
        fixture.detectChanges();

        await component.playChannel(radioChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(resolveRadioPlayback).toHaveBeenCalledWith(radioChannels()[0]);
        expect(resolveItvPlayback).not.toHaveBeenCalled();
        expect(ensureBulkItvEpg).not.toHaveBeenCalled();
        expect(fetchChannelEpg).not.toHaveBeenCalled();
        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('app-epg-timeline')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-audio-player')
        ).not.toBeNull();

        const audioPlayer = fixture.debugElement.query(
            By.directive(StubAudioPlayerComponent)
        ).componentInstance as StubAudioPlayerComponent;
        expect(audioPlayer.url()).toBe('https://stream.example/jazz.mp3');
        expect(audioPlayer.icon()).toBe('jazz.png');
        expect(audioPlayer.channelName()).toBe('Jazz FM');
        expect(audioPlayer.dispatchAdjacentChannelAction()).toBe(false);
    });
});

function buildProgram(channelId: string, title: string): EpgProgram {
    const startTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    const stopTimestamp = startTimestamp + 30 * 60;

    return {
        start: new Date(startTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        channel: channelId,
        title,
        desc: `${title} description`,
        category: null,
        startTimestamp,
        stopTimestamp,
    };
}
