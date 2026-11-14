import { EventEmitter, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
import type { PlaybackFallbackRequest } from '@iptvnator/playback/util';
import {
    LIVE_EPG_PANEL_STATE_STORAGE_KEY,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    ACTIVE_EPG_FALLBACK_SIZE,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { EpgListViewComponent, EpgTimelineComponent } from '@iptvnator/ui/epg';
import { AudioPlayerComponent } from '@iptvnator/ui/playback';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    ChannelListItemComponent,
    ResizableDirective,
} from '@iptvnator/ui/components';
import { MockPipe } from 'ng-mocks';
import { of } from 'rxjs';
import {
    ParentalLockService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    ElectronBridgeApi,
    EpgItem,
    EpgProgram,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { MatDialog } from '@angular/material/dialog';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import {
    MultiviewEntryService,
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';
import {
    StubAudioPlayerComponent,
    StubChannelListItemComponent,
    StubEpgTimelineComponent,
    liveCategoriesPopoverProvider,
    StubPortalEmptyStateComponent,
    StubResizableDirective,
    StubWebPlayerViewComponent,
} from './stalker-live-stream-layout.spec-stubs';

/** Installs an intentionally partial Electron bridge double. */
function installElectronBridge(bridge: Partial<ElectronBridgeApi>): void {
    window.electron = bridge as ElectronBridgeApi;
}

/**
 * The Stalker live layout as a multiview anchor (spec 11.2.4).
 */
describe('StalkerLiveStreamLayoutComponent multiview anchor', () => {
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
    const selectedItem = signal<
        ReturnType<typeof defaultItvChannels>[number] | null
    >(itvChannels()[0]);
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
    const itvFullChannelList = signal(itvChannels().slice(0, 0));
    const itvSelectedCategoryFromCache = signal(false);
    const isPaginatedContentLoading = signal(false);

    const stalkerStore = {
        getSelectedCategoryLabel: signal({ name: 'News', labelKey: null }),
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
        hasItvEpgMappingOverride: jest.fn((_id: string | number) => false),
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
        openExternalPlayback: jest.fn(),
    };
    const settingsStore = {
        openStreamOnDoubleClick: signal(false),
        resolvedEpgViewMode: signal<'timeline' | 'list'>('timeline'),
        resolvedEpgOffsetMinutes: signal(0),
    };
    const originalElectron = window.electron;

    beforeEach(async () => {
        // The store mock is module-scoped: reset so a failed test can't leak
        // 'list' into siblings.
        settingsStore.resolvedEpgViewMode.set('timeline');
        playlist.set({ _id: 'playlist-1', title: 'Demo Stalker' });
        installElectronBridge({
            platform: 'darwin',
            setUserAgent: jest.fn().mockResolvedValue(true),
            updateRemoteControlStatus: jest.fn(),
            onChannelChange: jest.fn(() => jest.fn()),
            onRemoteControlCommand: jest.fn(() => jest.fn()),
        });

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
        portalPlayer.openExternalPlayback.mockClear();
        fetchChannelEpg.mockReset();
        fetchChannelEpg.mockResolvedValue([]);
        // mockReset drops the implementation; undefined reads as "unmapped".
        stalkerStore.hasItvEpgMappingOverride.mockReset();
        ensureBulkItvEpg.mockReset();
        mockBulkEpg({
            '10001': [buildProgram('10001', 'Current Show')],
            '10002': [buildProgram('10002', 'Next Channel Show')],
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
                liveCategoriesPopoverProvider,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsProviderEpg() {
                            return Boolean(window.electron);
                        },
                        get isElectron() {
                            return Boolean(window.electron);
                        },
                        get supportsEpgMapping() {
                            return Boolean(window.electron);
                        },
                    },
                },
                { provide: PlaylistsService, useValue: playlistService },
                { provide: SettingsStore, useValue: settingsStore },
                {
                    provide: ParentalLockService,
                    useValue: { version: signal(0), active: signal(false) },
                },
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
                        getEpgMappingsBatch: jest.fn().mockResolvedValue(null),
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

    function mockBulkEpg(bulkPrograms: Record<string, EpgProgram[]>): void {
        ensureBulkItvEpg.mockImplementation(async () => {
            bulkItvEpgByChannel.set(bulkPrograms);
            bulkItvEpgLoaded.set(true);
            bulkItvEpgPlaylistId.set('playlist-1');
            bulkItvEpgPeriodHours.set(168);
            selectedItvEpgPrograms.set(
                bulkPrograms[selectedItvId() ?? ''] ?? []
            );
        });
    }

    const OTHER: MultiviewTileSource = {
        playback: {
            streamUrl: 'https://example.com/beta.m3u8',
            title: 'Beta TV',
            isLive: true,
        },
        playbackSessionKey: 'live|playlist-1|10002',
        kind: 'live',
        playlistId: 'playlist-1',
        contentId: '10002',
        title: 'Beta TV',
    };

    const inlinePlayer = (): HTMLElement | null =>
        fixture.nativeElement.querySelector('app-web-player-view');
    const placeholder = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="multiview-anchor-placeholder"]'
        );

    async function playFirstChannel(): Promise<void> {
        fixture.detectChanges();
        await component.playChannel(itvChannels()[0], true);
        fixture.detectChanges();
    }

    async function startSession(): Promise<void> {
        await playFirstChannel();
        TestBed.inject(MultiviewEntryService).add(OTHER);
        fixture.detectChanges();
    }

    it('renders the inline player as before while no session exists', async () => {
        await playFirstChannel();

        expect(inlinePlayer()).not.toBeNull();
        expect(placeholder()).toBeNull();
        expect(component.multiviewAnchor.host.source()).toMatchObject({
            playbackSessionKey: component.playbackSessionKey(),
            kind: 'live',
            playlistId: 'playlist-1',
            contentId: '10001',
        });
    });

    it('hands the playing channel to tile 1 when a session starts here', async () => {
        await startSession();
        const store = TestBed.inject(MultiviewSessionStore);

        expect(store.anchorId()).toBe('stalker-live');
        expect(store.tiles()[0].contentId).toBe('10001');
        expect(inlinePlayer()).toBeNull();
        expect(placeholder()).not.toBeNull();
    });

    it('resolves the surviving channel again when the session ends', async () => {
        await startSession();
        const store = TestBed.inject(MultiviewSessionStore);
        resolveItvPlayback.mockClear();

        store.setAudio(store.tiles()[1].id);
        store.exit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(resolveItvPlayback).toHaveBeenCalledWith(
            expect.objectContaining({ id: '10002' })
        );
        expect(inlinePlayer()).not.toBeNull();
    });

    it('ends the session when the layout is left', async () => {
        await startSession();

        fixture.destroy();

        expect(TestBed.inject(MultiviewSessionStore).exists()).toBe(false);
    });
});

function buildProgram(channelId: string, title: string): EpgProgram {
    const startTimestamp = Math.floor(Date.now() / 1000) - 10 * 60;
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
