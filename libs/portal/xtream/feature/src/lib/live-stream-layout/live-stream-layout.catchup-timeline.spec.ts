import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MockComponent, MockPipe } from 'ng-mocks';
import { TranslateModule, TranslatePipe } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
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
    EpgGuideNowPlayingComponent,
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
    EpgProgram,
    type ExternalPlayerSession,
} from '@iptvnator/shared/interfaces';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import {
    playlist,
    sampleChannel,
    StubEpgTimelineComponent,
    StubGridListComponent,
    StubPortalChannelsListComponent,
    StubWebPlayerViewComponent,
} from './live-stream-layout-stubs.spec-data';

const HOUR = 3600;
const T0 = Date.parse('2026-04-04T10:00:00.000Z') / 1000;

function epgItem(title: string, fromHour: number, toHour: number): EpgItem {
    const start = new Date((T0 + fromHour * HOUR) * 1000).toISOString();
    const stop = new Date((T0 + toHour * HOUR) * 1000).toISOString();
    return {
        id: title,
        epg_id: `epg-${title}`,
        title,
        description: '',
        lang: 'en',
        start,
        stop,
        end: stop,
        channel_id: 'channel-101',
        start_timestamp: String(T0 + fromHour * HOUR),
        stop_timestamp: String(T0 + toHour * HOUR),
    };
}

/**
 * Catch-up programmes on the player's seek bar. Split from
 * `live-stream-layout.component.spec.ts`, which sits at the spec line cap.
 */
describe('LiveStreamLayoutComponent catch-up timeline segments', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    const emptyList = signal<unknown[]>([]);
    const epgItems = signal<EpgItem[]>([]);
    const parentalLock = {
        version: signal(0),
        active: signal(false),
        isXtreamCategoryLocked: jest.fn(() => false),
    };
    const databaseService = {
        getAllXtreamCategories: jest.fn(async () => [] as unknown[]),
    };
    const runtime = {
        supportsXtreamSqliteDataSource: false,
        supportsDownloads: true,
        supportsProviderCatchUp: true,
        supportsProviderEpg: true,
    };
    const portalPlayer = {
        isEmbeddedPlayer: signal(true),
        openExternalPlayback: jest.fn(),
    };
    const externalSession = signal<ExternalPlayerSession | null>(null);
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
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
        loadMoreContent: jest.fn(),
    };

    beforeEach(async () => {
        epgItems.set([]);
        runtime.supportsProviderCatchUp = true;
        portalPlayer.isEmbeddedPlayer.set(true);
        externalSession.set(null);
        emptyList.set([]);
        xtreamStore.openPlayer.mockReset();

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
                    useValue: { activeSession: externalSession },
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

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        TestBed.inject(LiveLayoutSidebarStateService).setState(
            'portal',
            'expanded'
        );
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    const webPlayer = () =>
        fixture.debugElement.query(By.directive(StubWebPlayerViewComponent))
            .componentInstance as StubWebPlayerViewComponent;

    it('launches a pending external guide channel once per gesture and allows retry after failure', async () => {
        const playing = { ...sampleChannel, category_id: 1 };
        const next = { ...playing, xtream_id: 102 };
        emptyList.set([playing, next]);
        portalPlayer.isEmbeddedPlayer.set(false);
        component.playLive(playing, true);
        externalSession.set({
            id: 'synthetic-session',
            streamUrl: component.activeStreamUrl(),
            title: 'Synthetic Live Channel',
            player: 'mpv',
            status: 'playing',
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
            canClose: true,
        });
        component.guide.open();
        fixture.detectChanges();
        expect(component.guide.isOpen()).toBe(true);
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        let fail!: (error: Error) => void;
        const launch = new Promise<void>((_resolve, reject) => (fail = reject));
        xtreamStore.openPlayer.mockReturnValueOnce(launch);
        xtreamStore.constructStreamUrl.mockReturnValueOnce(
            'https://example.com/second.ts'
        );
        source.activate('102');
        source.activate('102');
        source.activate('102');
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
        expect(source.activeChannelId()).toBe(String(sampleChannel.xtream_id));

        fail(new Error('synthetic launch failure'));
        await Promise.resolve();
        xtreamStore.constructStreamUrl.mockReturnValueOnce(
            'https://example.com/second.ts'
        );
        source.activate('102');
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
    });

    it.each([
        'restores original',
        'opens intermediate',
        'restores intermediate',
        'restores intermediate after late launch update',
    ] as const)(
        'tracks the confirmed external channel during overlapping switches (%s)',
        (outcome) => {
            portalPlayer.isEmbeddedPlayer.set(false);
            component.guide.collapsed.set(false);
            component.playLive(sampleChannel, false);
            expect(component.guide.available()).toBe(false);

            component.playLive(sampleChannel, true);
            const session: ExternalPlayerSession = {
                id: 'synthetic-external-session',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Live Channel',
                player: 'mpv',
                status: 'launching',
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
                canClose: true,
            };
            externalSession.set(session);
            expect(component.guide.available()).toBe(false);
            externalSession.set({ ...session, status: 'playing' });
            component.guide.open();
            fixture.detectChanges();
            const summary = fixture.debugElement.query(
                By.directive(EpgGuideNowPlayingComponent)
            );
            expect(summary.componentInstance.collapsed()).toBe(true);
            expect(summary.componentInstance.collapsible()).toBe(false);
            expect(component.guide.collapsed()).toBe(false);

            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/next.ts'
            );
            component.playLive({ ...sampleChannel, xtream_id: 102 }, true);
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(true);
            expect(component.guideNowPlayingChannel()).toBe(session.title);

            const replacement = {
                ...session,
                id: 'synthetic-replacement',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Replacement Channel',
            };
            const late =
                outcome === 'restores intermediate after late launch update';
            if (!late) {
                externalSession.set(replacement);
                fixture.detectChanges();
            }
            expect(component.guide.isOpen()).toBe(true);

            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/third.ts'
            );
            component.playLive({ ...sampleChannel, xtream_id: 103 }, true);
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(true);

            const third = {
                ...session,
                id: 'synthetic-third',
                streamUrl: component.activeStreamUrl(),
            };
            if (late) {
                externalSession.set(replacement);
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
            }
            const restoreIntermediate =
                late || outcome === 'restores intermediate';
            if (restoreIntermediate) {
                externalSession.set(third);
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
            }
            const original = outcome === 'restores original';
            const confirmed = original ? session : replacement;
            externalSession.set({
                ...confirmed,
                status: 'playing',
                restoredFromSessionId: original
                    ? replacement.id
                    : restoreIntermediate
                      ? third.id
                      : undefined,
            });
            fixture.detectChanges();

            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            expect(component.guide.isOpen()).toBe(true);
            expect(component.guideNowPlayingChannel()).toBe(confirmed.title);
            expect(source.activeChannelId()).toBe(
                String(original ? sampleChannel.xtream_id : 102)
            );
            expect(source.livePlayback()).toBe(true);
        }
    );

    it('offers archive playback where provider catch-up can play', () => {
        expect(component.archivePlaybackAvailable()).toBe(true);
        expect(component.archiveDownloadsAvailable()).toBe(true);
    });

    it('offers no archive playback or download where provider catch-up cannot play', () => {
        // The computed reads the flag once; build the layout after the flip.
        runtime.supportsProviderCatchUp = false;
        fixture.destroy();
        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();

        expect(component.archivePlaybackAvailable()).toBe(false);
        expect(component.archiveDownloadsAvailable()).toBe(false);
    });

    it('draws the archive window programmes until live playback resumes', async () => {
        epgItems.set([
            epgItem('Morning News', -1, 0),
            epgItem('Archived Show', 0, 1),
            epgItem('Afternoon Film', 1, 3),
        ]);
        component.playLive(sampleChannel);
        fixture.detectChanges();
        expect(webPlayer().timelineSegments()).toBeNull();

        const archived: EpgProgram = {
            ...component.controlledEpgPrograms()[1],
        };
        await component.onProgramActivated({
            type: 'timeshift',
            program: archived,
        });
        fixture.detectChanges();

        // Xtream's timeshift URL requests exactly the programme.
        expect(webPlayer().timelineSegments()).toEqual([
            { startSeconds: 0, endSeconds: HOUR, title: 'Archived Show' },
        ]);

        component.playLive(sampleChannel);
        fixture.detectChanges();
        expect(webPlayer().timelineSegments()).toBeNull();
    });
});
