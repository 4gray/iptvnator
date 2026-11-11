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
    const closeSession = jest.fn(
        async (_session: ExternalPlayerSession) => undefined
    );
    const updateRemoteControlStatus = jest.fn();
    const onChannelChange = jest.fn(
        (_change: (event: { direction: 'up' | 'down' }) => void) => jest.fn()
    );
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
        loadEpg: jest.fn(),
        setSelectedCategory: jest.fn(),
        loadMoreContent: jest.fn(),
    };

    beforeEach(async () => {
        previousElectron = window.electron;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { updateRemoteControlStatus, onChannelChange },
        });
        updateRemoteControlStatus.mockClear();
        onChannelChange.mockClear();
        closeSession.mockClear();
        parentalLock.active.set(false);
        parentalLock.version.set(0);
        parentalLock.isXtreamCategoryLocked.mockReset().mockReturnValue(false);
        xtreamStore.selectedItem.set(sampleChannel);
        epgItems.set([]);
        runtime.supportsProviderCatchUp = true;
        portalPlayer.isEmbeddedPlayer.set(true);
        externalSession.set(null);
        emptyList.set([]);
        xtreamStore.openPlayer.mockReset();
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
                    useValue: { activeSession: externalSession, closeSession },
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

    afterEach(() => {
        fixture.destroy();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: previousElectron,
        });
    });

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
        fixture.detectChanges();
        component.guide.close();
        expect(component.activeStreamUrl()).toBe('https://example.com/live.ts');
        expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(playing);
        component.guide.open();
        xtreamStore.constructStreamUrl.mockReturnValueOnce(
            'https://example.com/second.ts'
        );
        source.activate('102');
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
    });

    it('commits the remote channel order only after an external guide switch opens', () => {
        const playing = { ...sampleChannel, category_id: 1 };
        const neighbor = { ...playing, xtream_id: 103 };
        const next = {
            ...playing,
            name: 'Synthetic Replacement Channel',
            xtream_id: 102,
            category_id: 2,
        };
        const nextNeighbor = { ...next, xtream_id: 104 };
        const categories = xtreamStore.getCategoriesBySelectedType();
        xtreamStore.getCategoriesBySelectedType.set([
            ...categories,
            { category_id: 2, category_name: 'Synthetic Group' },
        ]);
        try {
            emptyList.set([playing, neighbor, next, nextNeighbor]);
            portalPlayer.isEmbeddedPlayer.set(false);
            component.playLive(playing, true, [playing, neighbor]);
            const original: ExternalPlayerSession = {
                id: 'synthetic-first',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Channel',
                player: 'mpv',
                status: 'playing',
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
                canClose: true,
            };
            externalSession.set(original);
            component.guide.open();
            fixture.detectChanges();
            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            const queue = () =>
                component.channelNavigation
                    .remoteChannels()
                    .map(({ xtream_id }) => xtream_id);
            source.setScope('2');
            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/second.ts'
            );
            source.activate('102');
            const replacement: ExternalPlayerSession = {
                ...original,
                id: 'synthetic-second',
                streamUrl: component.activeStreamUrl(),
                status: 'launching',
            };
            externalSession.set(replacement);
            xtreamStore.selectedItem.set(next);
            fixture.detectChanges();
            expect(queue()).toEqual([101, 103]);
            expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    channelName: playing.name,
                    channelNumber: 1,
                })
            );
            onChannelChange.mock.lastCall?.[0]({ direction: 'up' });
            expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(
                neighbor,
                expect.any(Function)
            );
            externalSession.set({
                ...original,
                restoredFromSessionId: replacement.id,
            });
            fixture.detectChanges();
            expect(queue()).toEqual([101, 103]);

            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                replacement.streamUrl
            );
            source.activate('102');
            externalSession.set({
                ...replacement,
                id: 'synthetic-retry',
                status: 'opened',
            });
            fixture.detectChanges();
            expect(queue()).toEqual([102, 104]);
            expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    channelName: next.name,
                    channelNumber: 1,
                })
            );
        } finally {
            xtreamStore.getCategoriesBySelectedType.set(categories);
        }
    });

    it.each([
        'playing',
        'replacement',
        'replacement with closable error',
    ] as const)(
        'stops the %s external channel when parental controls relock it',
        (locked) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: 102, category_id: 2 };
            portalPlayer.isEmbeddedPlayer.set(false);
            component.playLive(playing, true);
            const original: ExternalPlayerSession = {
                id: 'synthetic-locked-session',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Locked Channel',
                player: 'mpv',
                status: 'playing',
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
                canClose: true,
            };
            externalSession.set(original);
            component.guide.open();
            fixture.detectChanges();
            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/second.ts'
            );
            component.playLive(next, true);
            const pending = {
                ...original,
                id: 'synthetic-pending-session',
                streamUrl: component.activeStreamUrl(),
                status: 'launching',
                canClose: false,
            } as const;
            externalSession.set(pending);
            fixture.detectChanges();

            parentalLock.isXtreamCategoryLocked.mockImplementation(
                (_playlist, _type, category) =>
                    category === (locked === 'playing' ? 1 : 2)
            );
            parentalLock.active.set(true);
            parentalLock.version.update((version) => version + 1);
            fixture.detectChanges();
            if (locked !== 'playing') {
                expect(component.activeStreamUrl()).toBe(original.streamUrl);
                expect(
                    fixture.debugElement.query(By.directive(EpgGuideComponent))
                ).not.toBeNull();
                expect(closeSession).not.toHaveBeenCalled();
                const opened = {
                    ...pending,
                    status: locked === 'replacement' ? 'opened' : 'error',
                    canClose: true,
                } as const;
                externalSession.set(opened);
                fixture.detectChanges();
                expect(closeSession).toHaveBeenCalledWith(opened);
                expect(component.guide.available()).toBe(false);
                expect(xtreamStore.loadEpg).toHaveBeenCalledTimes(1);
                expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(
                    playing
                );
                return;
            }
            expect(closeSession).toHaveBeenCalledWith(original);
            expect(component.guide.available()).toBe(false);

            externalSession.set({
                ...original,
                restoredFromSessionId: pending.id,
            });
            fixture.detectChanges();
            expect(component.guideNowPlayingChannel()).toBe('');
            expect(component.activeStreamUrl()).toBe(pending.streamUrl);
            expect(xtreamStore.setSelectedItem).not.toHaveBeenCalledWith(
                playing
            );
            expect(xtreamStore.loadEpg).not.toHaveBeenCalled();
            expect(closeSession).toHaveBeenCalledTimes(1);
        }
    );

    it.each([true, false])(
        'switches EPG copies without restarting playback (embedded: %s)',
        (embedded) => {
            const playing = {
                ...sampleChannel,
                category_id: 1,
                epg_channel_id: 'synthetic.first',
            };
            const copy = {
                ...playing,
                category_id: 2,
                epg_channel_id: 'synthetic.copy',
            };
            const categories = xtreamStore.getCategoriesBySelectedType();
            xtreamStore.getCategoriesBySelectedType.set([
                ...categories,
                { category_id: 2, category_name: 'Synthetic Copy Group' },
            ]);
            try {
                emptyList.set([playing, copy]);
                portalPlayer.isEmbeddedPlayer.set(embedded);
                component.playLive(playing, true);
                const playback = component.activePlayback()!;
                if (!embedded)
                    externalSession.set({
                        id: 'synthetic-copy-switch-session',
                        streamUrl: playback.streamUrl,
                        title: 'Synthetic Channel',
                        player: 'mpv',
                        status: 'playing',
                        startedAt: '2026-04-04T10:00:00Z',
                        updatedAt: '2026-04-04T10:00:00Z',
                        canClose: true,
                    });
                component.guide.open();
                fixture.detectChanges();
                const source = fixture.debugElement.injector.get(
                    XtreamEpgGuideSourceService
                );
                expect(source.activeChannelId()).toBe('101');
                source.setScope('2');
                expect(source.activeChannelId()).toBeNull();
                source.activate('101');
                fixture.detectChanges();
                expect(source.activeChannelId()).toBe('101');
                expect(source.playingItem()).toBe(copy);
                expect(component.activePlayback()).toBe(playback);
                expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(
                    copy
                );
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                    embedded ? 0 : 1
                );
            } finally {
                xtreamStore.getCategoriesBySelectedType.set(categories);
            }
        }
    );

    it('keeps the remote queue and guide on external playback when a preview is relocked', () => {
        const playing = { ...sampleChannel, category_id: 1 };
        const neighbor = { ...playing, xtream_id: 103 };
        const preview = { ...playing, xtream_id: 102, category_id: 2 };
        emptyList.set([playing, neighbor, preview]);
        portalPlayer.isEmbeddedPlayer.set(false);
        component.playLive(playing, true, [playing, neighbor]);
        const confirmed: ExternalPlayerSession = {
            id: 'synthetic-playing',
            streamUrl: component.activeStreamUrl(),
            title: 'Synthetic Channel',
            player: 'mpv',
            status: 'playing',
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
            canClose: true,
        };
        externalSession.set(confirmed);
        fixture.detectChanges();
        xtreamStore.constructStreamUrl.mockReturnValueOnce(
            'https://example.com/preview.ts'
        );
        component.playLive(preview, false, [preview]);
        fixture.detectChanges();
        expect(component.channelNavigation.remoteChannels()).toEqual([
            playing,
            neighbor,
        ]);
        component.guide.open();
        fixture.detectChanges();
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_playlist, _type, category) => category === 2
        );
        parentalLock.version.update((version) => version + 1);
        fixture.detectChanges();
        expect(component.activeStreamUrl()).toBe('');
        expect(component.guide.isOpen()).toBe(true);
        expect(
            fixture.debugElement.query(By.directive(EpgGuideComponent))
        ).not.toBeNull();
        expect(component.guideNowPlayingChannel()).toBe(confirmed.title);
        expect(closeSession).not.toHaveBeenCalled();
    });

    it.each(['preview', 'pending'] as const)(
        'uses the latest external guide copy with a %s',
        (state) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = {
                ...playing,
                xtream_id: 102,
                epg_channel_id: 'synthetic.first',
            };
            const copy = {
                ...(state === 'preview' ? playing : next),
                category_id: 2,
                epg_channel_id: 'synthetic.copy',
            };
            const categories = xtreamStore.getCategoriesBySelectedType();
            xtreamStore.getCategoriesBySelectedType.set([
                ...categories,
                { category_id: 2, category_name: 'Synthetic Copy Group' },
            ]);
            try {
                emptyList.set([playing, next, copy]);
                portalPlayer.isEmbeddedPlayer.set(false);
                component.playLive(playing, true);
                const original: ExternalPlayerSession = {
                    id: 'synthetic-original',
                    streamUrl: component.activeStreamUrl(),
                    title: 'Synthetic Channel',
                    player: 'mpv',
                    status: 'playing',
                    startedAt: '2026-04-04T10:00:00Z',
                    updatedAt: '2026-04-04T10:00:00Z',
                    canClose: true,
                };
                externalSession.set(original);
                fixture.detectChanges();
                if (state === 'preview') component.playLive(next, false);
                component.guide.open();
                fixture.detectChanges();
                const source = fixture.debugElement.injector.get(
                    XtreamEpgGuideSourceService
                );
                if (state === 'pending') {
                    xtreamStore.constructStreamUrl.mockReturnValueOnce(
                        'https://example.com/pending.ts'
                    );
                    source.activate('102');
                }
                const playback = component.activePlayback();
                source.setScope('2');
                source.activate(String(copy.xtream_id));
                if (state === 'pending')
                    externalSession.set({
                        ...original,
                        id: 'synthetic-pending',
                        streamUrl: playback!.streamUrl,
                        status: 'opened',
                    });
                fixture.detectChanges();
                expect(source.playingItem()).toBe(copy);
                expect(component.activePlayback()).toBe(playback);
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                    state === 'preview' ? 1 : 2
                );
                if (state === 'pending')
                    expect(
                        xtreamStore.setSelectedItem
                    ).toHaveBeenLastCalledWith(copy);
            } finally {
                xtreamStore.getCategoriesBySelectedType.set(categories);
            }
        }
    );

    it.each([
        'restores original',
        'opens intermediate',
        'restores intermediate',
        'restores intermediate after late launch update',
    ] as const)(
        'tracks the confirmed external channel during overlapping switches (%s)',
        (outcome) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: 102 };
            emptyList.set([playing, next]);
            portalPlayer.isEmbeddedPlayer.set(false);
            component.guide.collapsed.set(false);
            component.playLive(playing, false);
            expect(component.guide.available()).toBe(false);

            component.playLive(playing, true);
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
            component.playLive(next, true);
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
            if (original) {
                externalSession.set({
                    ...replacement,
                    restoredFromSessionId: third.id,
                });
                fixture.detectChanges();
                expect(component.guideNowPlayingChannel()).toBe(session.title);
            }
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
            component.guide.close();
            expect(component.activePlayback()?.streamUrl).toBe(
                confirmed.streamUrl
            );
            expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    xtream_id: original ? sampleChannel.xtream_id : 102,
                })
            );
            expect(xtreamStore.loadEpg).toHaveBeenCalled();
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
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
