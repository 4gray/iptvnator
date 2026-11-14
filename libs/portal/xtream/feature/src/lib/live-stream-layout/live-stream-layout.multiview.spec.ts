import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MockPipe } from 'ng-mocks';
import { TranslateModule, TranslatePipe } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import {
    LiveLayoutSidebarStateService,
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
    MultiviewEntryService,
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
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

/**
 * The layout as a multiview anchor (spec 11.2.4): its inline player is taken
 * over by a session and handed back when the session ends.
 */
describe('LiveStreamLayoutComponent multiview anchor', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    const emptyList = signal<unknown[]>([]);
    const parentalLock = {
        version: signal(0),
        active: signal(false),
        isXtreamCategoryLocked: jest.fn(
            (_playlistId: string, _type: string, _xtreamId: number) => false
        ),
    };
    const databaseService = {
        getAllXtreamCategories: jest.fn(async () => [] as unknown[]),
    };
    const runtime = { supportsXtreamSqliteDataSource: false };
    const xtreamStore = {
        getCategoriesBySelectedType: signal([
            { category_id: 1, category_name: 'News' },
        ]),
        liveCategories: signal([{ id: 41, xtream_id: 7, name: 'Adult' }]),
        getCategoryItemCounts: signal(new Map<number, number>([[1, 1]])),
        getPaginatedContent: emptyList,
        hasMoreContent: signal(false),
        epgItems: emptyList,
        currentEpgItem: signal(null),
        isLoadingEpg: signal(false),
        selectedTypeContentLoading: signal(false),
        selectedCategoryId: signal<number | null>(1),
        selectedContentType: signal('live'),
        selectedItem: signal(null),
        currentPlaylist: signal(playlist),
        liveStreams: signal<unknown[]>([]),
        isContentInitialized: signal(true),
        selectItemsFromSelectedCategory: jest.fn(() => []),
        constructStreamUrl: jest.fn(() => 'https://example.com/live.ts'),
        openPlayer: jest.fn(),
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
        loadMoreContent: jest.fn(),
    };

    beforeEach(async () => {
        parentalLock.version.set(0);
        parentalLock.active.set(false);
        parentalLock.isXtreamCategoryLocked.mockReset();
        parentalLock.isXtreamCategoryLocked.mockReturnValue(false);
        databaseService.getAllXtreamCategories.mockReset();
        databaseService.getAllXtreamCategories.mockResolvedValue([]);
        xtreamStore.liveStreams.set([]);
        xtreamStore.setSelectedItem.mockClear();
        runtime.supportsXtreamSqliteDataSource = false;

        await TestBed.configureTestingModule({
            imports: [
                LiveStreamLayoutComponent,
                NoopAnimationsModule,
                // The programme guide's source translates its labels.
                TranslateModule.forRoot(),
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
                        resolveCatchupUrl: jest.fn(),
                    },
                },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                { provide: DatabaseService, useValue: databaseService },
                {
                    provide: SettingsStore,
                    useValue: {
                        player: signal(VideoPlayer.VideoJs),
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openExternalPlayback: jest.fn(),
                    },
                },
                { provide: ParentalLockService, useValue: parentalLock },
            ],
        })
            .overrideComponent(LiveStreamLayoutComponent, {
                remove: {
                    imports: [
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

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        TestBed.inject(LiveLayoutSidebarStateService).setState(
            'portal',
            'expanded'
        );
        fixture.detectChanges();
    });

    afterEach(() => fixture?.destroy());

    const OTHER: MultiviewTileSource = {
        playback: {
            streamUrl: 'https://xtream.example/live/202.m3u8',
            title: 'Channel 202',
            isLive: true,
        },
        playbackSessionKey: 'live|playlist-1|202',
        kind: 'live',
        playlistId: 'playlist-1',
        contentId: '202',
        title: 'Channel 202',
    };

    const inlinePlayer = (): HTMLElement | null =>
        fixture.nativeElement.querySelector('app-web-player-view');
    const placeholder = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="multiview-anchor-placeholder"]'
        );

    function play(channel = sampleChannel): void {
        component.playLive({ ...channel, category_id: 1 });
        fixture.detectChanges();
    }

    it('renders the inline player as before while no session exists', () => {
        play();

        expect(inlinePlayer()).not.toBeNull();
        expect(placeholder()).toBeNull();
        expect(component.multiviewHost.source()).toMatchObject({
            playbackSessionKey: component.playbackSessionKey(),
            kind: 'live',
            contentId: '101',
            title: 'Channel 101',
        });
    });

    it('hands the playing channel to tile 1 when a session starts here', () => {
        play();
        TestBed.inject(MultiviewEntryService).add(OTHER);
        fixture.detectChanges();
        const store = TestBed.inject(MultiviewSessionStore);

        expect(store.anchorId()).toBe('xtream-live');
        expect(store.tiles()[0]).toMatchObject({
            playbackSessionKey: component.playbackSessionKey(),
            engine: VideoPlayer.VideoJs,
        });
        expect(inlinePlayer()).toBeNull();
        expect(placeholder()).not.toBeNull();
    });

    it('replaces tile 1 when another channel is played during the session', () => {
        play();
        TestBed.inject(MultiviewEntryService).add(OTHER);
        fixture.detectChanges();

        play({ ...sampleChannel, xtream_id: 303, name: 'Channel 303' });

        expect(TestBed.inject(MultiviewSessionStore).tiles()[0].contentId).toBe(
            '303'
        );
    });

    it('plays the surviving channel itself when the session ends', () => {
        xtreamStore.liveStreams.set([
            sampleChannel,
            { ...sampleChannel, xtream_id: 202, name: 'Channel 202' },
        ]);
        play();
        TestBed.inject(MultiviewEntryService).add(OTHER);
        fixture.detectChanges();
        const store = TestBed.inject(MultiviewSessionStore);

        store.setAudio(store.tiles()[1].id);
        store.exit();
        fixture.detectChanges();

        expect(component.multiviewHost.source()?.contentId).toBe('202');
        expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(
            expect.objectContaining({ xtream_id: 202 })
        );
        expect(inlinePlayer()).not.toBeNull();
    });

    it('ends the session when the layout is left', () => {
        play();
        TestBed.inject(MultiviewEntryService).add(OTHER);
        fixture.detectChanges();

        fixture.destroy();

        expect(TestBed.inject(MultiviewSessionStore).exists()).toBe(false);
    });
});
