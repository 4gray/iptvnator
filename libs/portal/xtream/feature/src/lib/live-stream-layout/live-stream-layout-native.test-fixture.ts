import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MockComponent, MockPipe } from 'ng-mocks';
import { TranslateModule, TranslatePipe } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import {
    LiveLayoutSidebarStateService,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    FavoritesService,
    XtreamStore,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    EpgArchiveCopyService,
    EpgArchiveDownloadService,
    EpgGuideComponent,
    EpgListViewComponent,
    EpgTimelineComponent,
} from '@iptvnator/ui/epg';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { GridListComponent } from '@iptvnator/portal/shared/ui';
import {
    DatabaseService,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    EpgItem,
    type ElectronBridgeRemoteControlCommand,
    type ExternalPlayerSession,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import {
    playlist,
    sampleChannel,
    StubEpgTimelineComponent,
    StubGridListComponent,
    StubPortalChannelsListComponent,
    StubWebPlayerViewComponent,
} from './live-stream-layout-stubs.spec-data';

export function setupLiveStreamLayoutNativeFixture() {
    let previousElectron: Window['electron'];
    const emptyList = signal<unknown[]>([]);
    const epgItems = signal<EpgItem[]>([]);
    const parentalLock = {
        version: signal(0),
        active: signal(false),
        isXtreamCategoryLocked: jest.fn(
            (_playlist: string, _type: string, _category: number) => false
        ),
    };
    const databaseService = {
        getAllXtreamCategories: jest.fn(async () => [] as unknown[]),
    };
    const runtime = {
        supportsXtreamSqliteDataSource: false,
        supportsDownloads: true,
        supportsProviderCatchUp: true,
        supportsProviderEpg: true,
        supportsRemoteControl: true,
    };
    const portalPlayer = {
        isEmbeddedPlayer: signal(true),
        openExternalPlayback: jest.fn(),
    };
    const externalSession = signal<ExternalPlayerSession | null>(null);
    const stopRequested = new Subject<string>();
    const closeSession = jest.fn(
        async (_session: ExternalPlayerSession) => undefined
    );
    const updateRemoteControlStatus = jest.fn();
    const onExternalPlayerSessionUpdate = jest.fn(
        (_update: (session: ExternalPlayerSession) => void) => jest.fn()
    );
    const launchIds = new Map<string, string>();
    function publishExternalSession(session: ExternalPlayerSession | null) {
        externalSession.set(session);
        if (!session) return;
        const used = new Set(launchIds.values());
        const candidate =
            launchIds.get(session.id) ??
            xtreamStore.openPlayer.mock.calls.find(
                ([url, , , , , id]) =>
                    url === session.streamUrl &&
                    typeof id === 'string' &&
                    !used.has(id)
            )?.[5];
        const launchId = typeof candidate === 'string' ? candidate : undefined;
        if (launchId) launchIds.set(session.id, launchId);
        onExternalPlayerSessionUpdate.mock.lastCall?.[0]({
            reuseAvailable: true,
            ...session,
            launchId,
        });
    }
    const onChannelChange = jest.fn(
        (_change: (event: { direction: 'up' | 'down' }) => void) => jest.fn()
    );
    const onRemoteControlCommand = jest.fn(
        (_command: (event: ElectronBridgeRemoteControlCommand) => void) =>
            jest.fn()
    );
    const player = signal(VideoPlayer.MPV);
    const mpvPlayerPath = signal('');
    const xtreamStore = {
        getCategoriesBySelectedType: signal([
            { category_id: 1, category_name: 'News' },
        ]),
        liveCategories: signal([{ id: 1, xtream_id: 1, name: 'News' }]),
        getCategoryItemCounts: signal(new Map<number, number>([[1, 1]])),
        getPaginatedContent: emptyList,
        hasMoreContent: signal(false),
        epgItems,
        currentEpgItem: signal(null),
        isLoadingEpg: signal(false),
        selectedTypeContentLoading: signal(false),
        selectedCategoryId: signal<number | null>(1),
        selectedContentType: signal('live'),
        selectedItem: signal<unknown>(sampleChannel),
        currentPlaylist: signal(playlist),
        liveStreams: emptyList,
        isContentInitialized: signal(true),
        selectItemsFromSelectedCategory: jest.fn(() => []),
        constructStreamUrl: jest.fn(() => 'https://example.com/live.ts'),
        openPlayer: jest.fn(),
        addRecentItem: jest.fn(),
        setSelectedItem: jest.fn(),
        loadEpg: jest.fn(),
        setSelectedCategory: jest.fn(),
        loadMoreContent: jest.fn(),
    };

    beforeEach(async () => {
        previousElectron = window.electron;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                updateRemoteControlStatus,
                onChannelChange,
                onRemoteControlCommand,
                onExternalPlayerSessionUpdate,
            },
        });
        updateRemoteControlStatus.mockClear();
        onChannelChange.mockClear();
        onRemoteControlCommand.mockClear();
        player.set(VideoPlayer.MPV);
        mpvPlayerPath.set('');
        onExternalPlayerSessionUpdate.mockClear();
        launchIds.clear();
        closeSession.mockClear();
        parentalLock.active.set(false);
        parentalLock.version.set(0);
        parentalLock.isXtreamCategoryLocked.mockReset().mockReturnValue(false);
        xtreamStore.currentPlaylist.set(playlist);
        xtreamStore.selectedItem.set(sampleChannel);
        epgItems.set([]);
        runtime.supportsProviderCatchUp = true;
        portalPlayer.isEmbeddedPlayer.set(true);
        publishExternalSession(null);
        emptyList.set([]);
        xtreamStore.openPlayer.mockReset();
        xtreamStore.addRecentItem.mockClear();
        xtreamStore.setSelectedItem.mockClear();
        xtreamStore.loadEpg.mockClear();

        await TestBed.configureTestingModule({
            imports: [
                TranslateModule.forRoot(),
                LiveStreamLayoutComponent,
                NoopAnimationsModule,
            ],
            providers: [
                {
                    provide: EpgArchiveDownloadService,
                    useValue: { start: jest.fn() },
                },
                {
                    provide: EpgArchiveCopyService,
                    useValue: { copy: jest.fn() },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({}),
                        },
                        queryParamMap: of(convertToParamMap({})),
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        events: new Subject().asObservable(),
                        navigate: jest.fn(),
                    },
                },
                { provide: XtreamStore, useValue: xtreamStore },
                {
                    provide: FavoritesService,
                    useValue: { getFavorites: jest.fn(() => of([])) },
                },
                {
                    provide: XtreamUrlService,
                    useValue: {
                        constructAutoLiveTsUrl: jest.fn(() => undefined),
                        resolveCatchupUrl: jest.fn(
                            async () => 'https://example.com/timeshift.ts'
                        ),
                    },
                },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                { provide: DatabaseService, useValue: databaseService },
                {
                    provide: SettingsStore,
                    useValue: {
                        player,
                        mpvPlayerPath,
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: portalPlayer,
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: externalSession,
                        closeSession,
                        stopRequested,
                    },
                },
                { provide: ParentalLockService, useValue: parentalLock },
            ],
        })
            .overrideComponent(LiveStreamLayoutComponent, {
                remove: {
                    imports: [
                        EpgGuideComponent,
                        EpgListViewComponent,
                        EpgTimelineComponent,
                        GridListComponent,
                        PortalChannelsListComponent,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubEpgTimelineComponent,
                        MockComponent(EpgGuideComponent),
                        StubGridListComponent,
                        StubPortalChannelsListComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                        StubWebPlayerViewComponent,
                    ],
                },
            })
            .compileComponents();
    });

    const restoreElectron = () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: previousElectron,
        });
    };

    return {
        emptyList,
        epgItems,
        parentalLock,
        databaseService,
        runtime,
        portalPlayer,
        closeSession,
        stopRequested,
        updateRemoteControlStatus,
        onExternalPlayerSessionUpdate,
        publishExternalSession,
        restoreElectron,
        onChannelChange,
        onRemoteControlCommand,
        player,
        mpvPlayerPath,
        xtreamStore,
    };
}
