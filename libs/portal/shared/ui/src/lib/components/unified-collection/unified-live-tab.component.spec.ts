import {
    buildLiveItem,
    buildProgram,
    buildCurrentProgram,
    buildEpgItem,
    buildCurrentEpgItem,
    createDeferred,
} from './unified-live-tab.spec-data';
import { Clipboard } from '@angular/cdk/clipboard';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';
import {
    AudioPlayerComponent,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import {
    EpgListViewComponent,
    EpgProgramActivationEvent,
    EpgTimelineComponent,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ResizableDirective } from '@iptvnator/ui/components';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { EpgItem, EpgProgram, VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { createPlaybackSessionKey as sessionKey } from '@iptvnator/playback/util';
import {
    StubAudioPlayerComponent,
    StubEpgTimelineComponent,
    StubGlobalFavoritesListComponent,
    StubResizableDirective,
    StubWebPlayerViewComponent,
} from './unified-live-tab.spec-stubs';

describe('UnifiedLiveTabComponent', () => {
    let fixture: ComponentFixture<UnifiedLiveTabComponent>;
    let component: UnifiedLiveTabComponent;
    let player: ReturnType<typeof signal<VideoPlayer>>;
    let epgViewMode: ReturnType<typeof signal<'timeline' | 'list'>>;
    let epgOffsetMinutes: ReturnType<typeof signal<number>>;
    let stripCountryPrefix: ReturnType<typeof signal<boolean>>;
    let streamResolver: {
        resolveLiveDetail: jest.Mock;
        resolveM3uPlaybackDetail: jest.Mock;
        resolveXtreamCatchupUrl: jest.Mock;
        loadM3uProgramsForItem: jest.Mock;
        loadEpgForItems: jest.Mock;
    };
    let recentData: {
        recordLivePlayback: jest.Mock;
    };
    let portalPlayer: {
        isEmbeddedPlayer: jest.Mock;
        openResolvedPlayback: jest.Mock;
        openExternalPlayback: jest.Mock;
    };
    let snackBar: { open: jest.Mock };
    const originalElectron = window.electron;

    beforeEach(async () => {
        window.electron = {
            platform: 'darwin',
        } as typeof window.electron;

        localStorage.removeItem('live-epg-panel-state');

        streamResolver = {
            resolveLiveDetail: jest.fn(),
            resolveM3uPlaybackDetail: jest.fn(),
            resolveXtreamCatchupUrl: jest.fn().mockResolvedValue(null),
            loadM3uProgramsForItem: jest.fn().mockResolvedValue([]),
            loadEpgForItems: jest.fn().mockResolvedValue(new Map()),
        };
        recentData = {
            recordLivePlayback: jest.fn(),
        };
        player = signal(VideoPlayer.VideoJs);
        epgViewMode = signal<'timeline' | 'list'>('timeline');
        epgOffsetMinutes = signal(0);
        stripCountryPrefix = signal(false);
        portalPlayer = {
            isEmbeddedPlayer: jest.fn().mockReturnValue(false),
            openResolvedPlayback: jest.fn(),
            openExternalPlayback: jest.fn(),
        };
        snackBar = { open: jest.fn() };

        await TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), UnifiedLiveTabComponent],
            providers: [
                { provide: StreamResolverService, useValue: streamResolver },
                { provide: UnifiedRecentDataService, useValue: recentData },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        player,
                        stripCountryPrefix,
                        resolvedEpgViewMode: epgViewMode,
                        resolvedEpgOffsetMinutes: epgOffsetMinutes,
                    },
                },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
                { provide: MatSnackBar, useValue: snackBar },
            ],
        })
            .overrideComponent(UnifiedLiveTabComponent, {
                remove: {
                    imports: [
                        AudioPlayerComponent,
                        EpgListViewComponent,
                        EpgTimelineComponent,
                        GlobalFavoritesListComponent,
                        ResizableDirective,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubAudioPlayerComponent,
                        StubEpgTimelineComponent,
                        StubGlobalFavoritesListComponent,
                        StubResizableDirective,
                        StubWebPlayerViewComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture?.destroy();
        window.electron = originalElectron;
    });

    it('renders controlled M3U EPG and records recent history on selection', async () => {
        const item = buildLiveItem('m3u');
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/m3u.m3u8',
                title: 'M3U Live',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Live',
                url: 'https://example.com/m3u.m3u8',
                group: { title: 'News' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: '',
                    logo: 'm3u.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [],
        });
        streamResolver.loadM3uProgramsForItem.mockResolvedValue([
            buildProgram('M3U Show'),
        ]);
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(streamResolver.loadM3uProgramsForItem).toHaveBeenCalledWith(
            item,
            expect.objectContaining({
                id: 'm3u-channel',
            })
        );
        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;
        expect(timeline.programs()).toEqual([buildProgram('M3U Show')]);
        expect(timeline.archivePlaybackAvailable()).toBe(false);
    });

    it('skips EPG loading and hides the EPG panel in browser/PWA playback', async () => {
        fixture.destroy();
        window.electron = undefined as unknown as typeof window.electron;

        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
        component = fixture.componentInstance;
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        streamResolver.loadEpgForItems.mockClear();
        streamResolver.loadM3uProgramsForItem.mockClear();
        const item = buildLiveItem('m3u');
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/m3u.m3u8',
                title: 'M3U Live',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Live',
                url: 'https://example.com/m3u.m3u8',
                group: { title: 'News' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: '',
                    logo: 'm3u.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [buildProgram('M3U Show')],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(streamResolver.loadEpgForItems).not.toHaveBeenCalled();
        expect(streamResolver.loadM3uProgramsForItem).not.toHaveBeenCalled();
        const list = fixture.debugElement.query(
            By.directive(StubGlobalFavoritesListComponent)
        ).componentInstance as StubGlobalFavoritesListComponent;
        expect(list.showEpg()).toBe(false);
        expect(
            fixture.nativeElement.querySelector('app-web-player-view')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.epg')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).toBeNull();
    });

    it('passes recent mode and favorite state to the shared live collection list', async () => {
        const item = buildLiveItem('m3u');
        const favoriteUids = new Set<string>([item.uid]);
        const toggledItems: UnifiedCollectionItem[] = [];
        const subscription = component.favoriteToggled.subscribe((toggled) =>
            toggledItems.push(toggled)
        );

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('favoriteUids', favoriteUids);
        fixture.detectChanges();
        await fixture.whenStable();

        const list = fixture.debugElement.query(
            By.directive(StubGlobalFavoritesListComponent)
        ).componentInstance as StubGlobalFavoritesListComponent;

        expect(list.mode()).toBe('recent');
        expect(list.favoriteUids()).toBe(favoriteUids);

        list.favoriteToggled.emit(list.channels()[0]);

        expect(toggledItems).toEqual([item]);
        subscription.unsubscribe();
    });

    it('maps shared live list remove requests back to collection items', async () => {
        const item = buildLiveItem('xtream');
        const removedItems: UnifiedCollectionItem[] = [];
        const subscription = component.removeItem.subscribe((removed) =>
            removedItems.push(removed)
        );

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        const list = fixture.debugElement.query(
            By.directive(StubGlobalFavoritesListComponent)
        ).componentInstance as StubGlobalFavoritesListComponent;

        list.removeRequested.emit(list.channels()[0]);

        expect(removedItems).toEqual([item]);
        subscription.unsubscribe();
    });

    it('snapshots the recording-start programme in the provider clock under a display offset', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        const item = buildLiveItem('m3u');
        const providerNow = buildCurrentProgram('Provider Now');
        const earlier: EpgProgram = {
            ...buildCurrentProgram('Really On Air'),
            start: new Date(Date.now() - 130 * 60 * 1000).toISOString(),
            stop: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        };
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/m3u.m3u8',
                title: 'M3U Live',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Live',
                url: 'https://example.com/m3u.m3u8',
                group: { title: 'News' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: '',
                    logo: 'm3u.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [earlier, providerNow],
        });
        streamResolver.loadM3uProgramsForItem.mockResolvedValue([
            earlier,
            providerNow,
        ]);
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();
        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.recordingMetadata()?.currentProgram?.title).toBe(
            'Provider Now'
        );

        // The guide runs an hour ahead: the recording must be filed under the
        // programme really on air, which the provider lists as an hour ago.
        epgOffsetMinutes.set(60);
        fixture.detectChanges();

        expect(component.recordingMetadata()?.currentProgram?.title).toBe(
            'Really On Air'
        );
    });

    it('renders inline M3U EPG in the timeline with shared date navigation', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        const item = buildLiveItem('m3u');
        const currentProgram = buildCurrentProgram('M3U Now');
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/m3u.m3u8',
                title: 'M3U Live',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Live',
                url: 'https://example.com/m3u.m3u8',
                group: { title: 'News' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: '',
                    logo: 'm3u.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [currentProgram],
        });
        streamResolver.loadM3uProgramsForItem.mockResolvedValue([
            currentProgram,
        ]);
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;

        expect(timeline.summary()).toEqual(
            expect.objectContaining({ title: 'M3U Now' })
        );
        expect(timeline.programs()).toEqual([currentProgram]);
        expect(timeline.selectedDate()).toBe(getTodayEpgDateKey());

        const nextDate = shiftEpgDateKey(getTodayEpgDateKey(), 'next');
        timeline.selectedDateChange.emit(nextDate);
        fixture.detectChanges();

        expect(component.selectedLiveEpgDate()).toBe(nextDate);
        expect(timeline.selectedDate()).toBe(nextDate);
    });

    it('swaps the timeline for the list view when epgViewMode is "list"', async () => {
        epgViewMode.set('list');
        const item = buildLiveItem('xtream');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [buildCurrentEpgItem('Xtream Now')],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

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
    });

    it('renders inline portal EPG in the timeline and flows collapse state through', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        const item = buildLiveItem('xtream');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [buildCurrentEpgItem('Xtream Now')],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;

        expect(timeline.summary()).toEqual(
            expect.objectContaining({ title: 'Xtream Now' })
        );
        expect(timeline.programs()).toEqual([
            expect.objectContaining({ title: 'Xtream Now' }),
        ]);
        expect(timeline.archivePlaybackAvailable()).toBe(false);
        expect(timeline.collapsed()).toBe(false);

        timeline.collapsedChange.emit(true);
        fixture.detectChanges();

        expect(component.isLiveEpgPanelCollapsed()).toBe(true);
        expect(localStorage.getItem('live-epg-panel-state')).toBe('collapsed');
        expect(timeline.collapsed()).toBe(true);
    });

    it('uses the shared web player wrapper for inline live playback diagnostics', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        player.set(VideoPlayer.VideoJs);
        const item = buildLiveItem('xtream');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        const webPlayer = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;

        expect(webPlayer.streamUrl()).toBe('https://example.com/xtream.m3u8');
        expect(webPlayer.title()).toBe('Xtream Live');
        const sourceId = item.playlistId;
        const contentId = String(item.xtreamId);
        const key = sessionKey({ kind: 'live', sourceId, contentId });
        expect(webPlayer.playbackSessionKey()).toBe(key);
        component.activeItem.set({ ...item, playlistId: 'p2', uid: 'c2' });
        expect(component.playbackSessionKey()).not.toBe(key);
        component.activeItem.set(item);
        const playback = webPlayer.playback();
        expect(playback).toEqual(
            expect.objectContaining({
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            })
        );
        if (!playback) {
            throw new Error('Expected wrapper playback to be set');
        }
        expect(webPlayer.playerOverride()).toBe(VideoPlayer.VideoJs);
        const host = fixture.nativeElement;
        expect(host.querySelector('app-vjs-player')).toBeNull();
        expect(host.querySelector('app-html-video-player')).toBeNull();
        expect(host.querySelector('app-art-player')).toBeNull();

        webPlayer.externalFallbackRequested.emit({
            player: 'mpv',
            playback,
            trackLaunch: jest.fn(),
            diagnostic: {
                code: 'network-error',
                player: 'videojs',
                source: 'hls',
                container: '',
                mimeType: '',
                videoCodecs: [],
                audioCodecs: [],
            },
        });

        const [forwardedPlayback, forwardedPlayer] =
            portalPlayer.openExternalPlayback.mock.calls[0];
        expect(forwardedPlayback).toBe(playback);
        expect(forwardedPlayer).toBe('mpv');
    });

    it('does not wait for M3U program lookup before opening playback', async () => {
        const item = buildLiveItem('m3u');
        const pendingPrograms = createDeferred<EpgProgram[]>();
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/m3u.m3u8',
                title: 'M3U Live',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Live',
                url: 'https://example.com/m3u.m3u8',
                group: { title: 'News' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: '',
                    logo: 'm3u.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [buildProgram('M3U Show')],
        });
        streamResolver.loadM3uProgramsForItem.mockReturnValue(
            pendingPrograms.promise
        );
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'https://example.com/m3u.m3u8',
            })
        );
        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(streamResolver.loadM3uProgramsForItem).toHaveBeenCalled();

        pendingPrograms.resolve([buildProgram('M3U Show')]);
        await fixture.whenStable();
    });

    it('renders inline audio for M3U radio items and skips external playback', async () => {
        const item = {
            ...buildLiveItem('m3u'),
            radio: 'true',
        } satisfies UnifiedCollectionItem;
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/radio.m3u8',
                title: 'M3U Radio',
                thumbnail: 'radio.png',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Radio',
                url: 'https://example.com/radio.m3u8',
                group: { title: 'Radio' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Radio',
                    url: '',
                    logo: 'radio.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'true',
                epgParams: '',
            },
            epgPrograms: [],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.channelsForList()[0].radio).toBe('true');

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(
            fixture.nativeElement.querySelector('app-audio-player')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).toBeNull();
    });

    it('renders inline audio for Stalker radio items and skips external playback', async () => {
        // Radio renders the dedicated audio player, never the shared web
        // player wrapper — so this test also pins that the tab itself
        // configures the scoped header override (portal cookie/token for
        // auth-gated streams) before the audio element gets the URL, and
        // clears it again on close.
        const setUserAgent = jest.fn().mockResolvedValue(true);
        (window.electron as unknown as Record<string, unknown>)[
            'setUserAgent'
        ] = setUserAgent;
        const item = {
            ...buildLiveItem('stalker'),
            name: 'Jazz Radio',
            radio: 'true',
        } satisfies UnifiedCollectionItem;
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/jazz.mp3',
                title: 'Jazz Radio',
                thumbnail: 'jazz.png',
                headers: {
                    'User-Agent': 'MAG250',
                    Referer: 'http://portal.example',
                    Cookie: 'mac=00:1A:79:00:00:01',
                    Authorization: 'Bearer TOKEN99',
                },
            },
            channel: {
                id: '40001',
                name: 'Jazz Radio',
                url: 'https://example.com/jazz.mp3',
                group: { title: 'Radio' },
                tvg: {
                    id: '40001',
                    name: 'Jazz Radio',
                    url: '',
                    logo: 'jazz.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'true',
                epgParams: '',
            },
            epgItems: [],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(
            fixture.nativeElement.querySelector('app-audio-player')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).toBeNull();

        const audioPlayer = fixture.debugElement.query(
            By.directive(StubAudioPlayerComponent)
        ).componentInstance as StubAudioPlayerComponent;
        expect(audioPlayer.url()).toBe('https://example.com/jazz.mp3');
        expect(audioPlayer.icon()).toBe('jazz.png');
        expect(audioPlayer.channelName()).toBe('Jazz Radio');

        expect(setUserAgent).toHaveBeenCalledWith(
            'MAG250',
            'http://portal.example',
            'https://example.com/jazz.mp3',
            {
                authorization: 'Bearer TOKEN99',
                cookie: 'mac=00:1A:79:00:00:01',
            }
        );

        component.onClose();

        // Closing the radio player must drop the portal credentials.
        expect(setUserAgent).toHaveBeenLastCalledWith(
            undefined,
            undefined,
            'https://example.com/jazz.mp3'
        );
    });

    it('renders shared EPG view for Xtream items and records recent history', async () => {
        const item = buildLiveItem('xtream');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [buildEpgItem('Xtream Show')],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;
        expect(timeline.programs()).toEqual([
            expect.objectContaining({ title: 'Xtream Show' }),
        ]);
        expect(timeline.archivePlaybackAvailable()).toBe(false);
    });

    it('renders shared EPG view for Stalker items and records recent history', async () => {
        const item = buildLiveItem('stalker');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/stalker.m3u8',
                title: 'Stalker Live',
            },
            epgItems: [buildEpgItem('Stalker Show')],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;
        expect(timeline.programs()).toEqual([
            expect.objectContaining({ title: 'Stalker Show' }),
        ]);
    });

    it('does not restart auto-open while the same live item is still resolving', async () => {
        const item = buildLiveItem('xtream');
        const pendingDetail = createDeferred<{
            epgMode: 'portal';
            playback: {
                streamUrl: string;
                title: string;
            };
            epgItems: EpgItem[];
        }>();
        const autoOpenHandledSpy = jest.spyOn(
            component.autoOpenHandled,
            'emit'
        );

        streamResolver.resolveLiveDetail.mockReturnValue(pendingDetail.promise);
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('autoOpenItem', {
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: item.playlistId,
            itemId: String(item.xtreamId),
            title: item.name,
            imageUrl: item.logo,
        });
        fixture.detectChanges();
        await Promise.resolve();

        expect(streamResolver.resolveLiveDetail).toHaveBeenCalledTimes(1);
        expect(component.isSelecting()).toBe(true);

        fixture.componentRef.setInput('items', [{ ...item }]);
        fixture.detectChanges();
        await Promise.resolve();

        expect(streamResolver.resolveLiveDetail).toHaveBeenCalledTimes(1);

        pendingDetail.resolve({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [buildEpgItem('Xtream Show')],
        });
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.activeDetail()).toEqual(
            expect.objectContaining({
                playback: expect.objectContaining({
                    streamUrl: 'https://example.com/xtream.m3u8',
                }),
            })
        );
        expect(autoOpenHandledSpy).toHaveBeenCalledTimes(1);
    });

    describe('M3U catch-up (timeshift) playback', () => {
        const selectCatchupChannel = async (rec = '3') => {
            const item = buildLiveItem('m3u');
            streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
                epgMode: 'm3u',
                playback: {
                    streamUrl: 'https://example.com/m3u.m3u8',
                    title: 'M3U Live',
                },
                channel: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: 'https://example.com/m3u.m3u8',
                    group: { title: 'News' },
                    tvg: {
                        id: 'm3u-channel',
                        name: 'M3U Live',
                        url: '',
                        logo: 'm3u.png',
                        rec,
                    },
                    http: { referrer: '', 'user-agent': '', origin: '' },
                    radio: 'false',
                    epgParams: '',
                },
                epgPrograms: [buildProgram('M3U Show')],
            });
            recentData.recordLivePlayback.mockResolvedValue(item);

            fixture.componentRef.setInput('items', [item]);
            fixture.detectChanges();
            await fixture.whenStable();

            await component.onChannelSelected(component.channelsForList()[0]);
            fixture.detectChanges();
            await fixture.whenStable();
        };

        const timeshiftEvent = (): EpgProgramActivationEvent => ({
            program: buildProgram('M3U Show'),
            type: 'timeshift',
        });

        it('copies M3U archive URLs without changing the active playback', async () => {
            await selectCatchupChannel();
            const before = component.inlinePlayback();
            const copy = jest
                .spyOn(TestBed.inject(Clipboard), 'copy')
                .mockReturnValue(true);
            component.onTimelineProgramActivated({
                ...timeshiftEvent(),
                type: 'copy-catchup-url',
            });
            await fixture.whenStable();
            expect(copy).toHaveBeenCalledWith(
                expect.stringContaining('https://example.com/m3u.m3u8?utc=')
            );
            expect(component.inlinePlayback()).toBe(before);
            expect(component.activeTimeshift()).toBeNull();
            copy.mockRestore();
        });

        it('switches the inline player to the catch-up stream on Watch', async () => {
            portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
            await selectCatchupChannel();

            component.onTimelineProgramActivated(timeshiftEvent());
            fixture.detectChanges();

            const playback = component.inlinePlayback();
            expect(playback?.streamUrl).toContain(
                'https://example.com/m3u.m3u8?utc='
            );
            expect(playback?.streamUrl).toContain('lutc=');
            expect(playback?.isLive).toBe(false);
            expect(component.activeTimeshiftProgram()?.title).toBe('M3U Show');
            expect(component.liveEpgPanelSummaryLabelKey()).toBe(
                'EPG.ARCHIVE_PLAYBACK'
            );
            expect(snackBar.open).not.toHaveBeenCalled();
        });

        it('shows feedback instead of failing silently when the channel has no catch-up', async () => {
            await selectCatchupChannel('');

            component.onTimelineProgramActivated(timeshiftEvent());

            expect(component.activeTimeshift()).toBeNull();
            expect(component.inlinePlayback()?.streamUrl).toBe(
                'https://example.com/m3u.m3u8'
            );
            expect(snackBar.open).toHaveBeenCalledTimes(1);
        });

        it('returns to the live stream from catch-up playback', async () => {
            await selectCatchupChannel();
            component.onTimelineProgramActivated(timeshiftEvent());

            component.returnToLivePlayback();

            expect(component.activeTimeshift()).toBeNull();
            expect(component.inlinePlayback()?.streamUrl).toBe(
                'https://example.com/m3u.m3u8'
            );
            expect(component.liveEpgPanelSummaryLabelKey()).toBe(
                'EPG.CURRENT_PROGRAM'
            );
        });

        it('activating "live" from the timeline resets catch-up playback', async () => {
            await selectCatchupChannel();
            component.onTimelineProgramActivated(timeshiftEvent());

            component.onTimelineProgramActivated({
                program: buildProgram('M3U Show'),
                type: 'live',
            });

            expect(component.activeTimeshift()).toBeNull();
        });

        it('clears catch-up playback when another channel is selected', async () => {
            await selectCatchupChannel();
            component.onTimelineProgramActivated(timeshiftEvent());

            component.onClose();

            expect(component.activeTimeshift()).toBeNull();
        });

        it('opens the external player on "Watch live" even without an active timeshift', async () => {
            await selectCatchupChannel();
            portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
            portalPlayer.openResolvedPlayback.mockClear();

            component.returnToLivePlayback();

            expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
                expect.objectContaining({
                    streamUrl: 'https://example.com/m3u.m3u8',
                })
            );
        });

        it('hands the catch-up stream to the external player when no inline player is used', async () => {
            await selectCatchupChannel();
            portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

            component.onTimelineProgramActivated(timeshiftEvent());

            expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
                expect.objectContaining({
                    isLive: false,
                    streamUrl: expect.stringContaining(
                        'https://example.com/m3u.m3u8?utc='
                    ),
                })
            );
        });
    });

    describe('Xtream (portal) catch-up (timeshift) playback', () => {
        const selectXtreamArchiveChannel = async (
            archive: Partial<UnifiedCollectionItem> = {
                tvArchive: 1,
                tvArchiveDuration: 5,
            }
        ) => {
            const item = { ...buildLiveItem('xtream'), ...archive };
            streamResolver.resolveLiveDetail.mockResolvedValue({
                epgMode: 'portal',
                playback: {
                    streamUrl: 'https://example.com/xtream.m3u8',
                    title: 'Xtream Live',
                },
                epgItems: [buildEpgItem('Xtream Show')],
            });
            recentData.recordLivePlayback.mockResolvedValue(item);

            fixture.componentRef.setInput('items', [item]);
            fixture.detectChanges();
            await fixture.whenStable();

            await component.onChannelSelected(component.channelsForList()[0]);
            fixture.detectChanges();
            await fixture.whenStable();

            return item;
        };

        const timeshiftEvent = (): EpgProgramActivationEvent => ({
            program: buildProgram('Xtream Show'),
            type: 'timeshift',
        });

        const queryTimeline = () =>
            fixture.debugElement.query(By.directive(StubEpgTimelineComponent))
                .componentInstance as StubEpgTimelineComponent;

        it('copies Xtream archive URLs without changing the active playback', async () => {
            streamResolver.resolveXtreamCatchupUrl.mockResolvedValue(
                'https://example.com/timeshift.ts'
            );
            await selectXtreamArchiveChannel();
            const before = component.inlinePlayback();
            const copy = jest
                .spyOn(TestBed.inject(Clipboard), 'copy')
                .mockReturnValue(true);
            component.onTimelineProgramActivated({
                ...timeshiftEvent(),
                type: 'copy-catchup-url',
            });
            await fixture.whenStable();
            expect(copy).toHaveBeenCalledWith(
                'https://example.com/timeshift.ts'
            );
            expect(component.inlinePlayback()).toBe(before);
            expect(component.activeTimeshift()).toBeNull();
            copy.mockRestore();
        });

        it('exposes the provider archive window to the timeline in days', async () => {
            // Regression: tv_archive_duration is days (matching
            // live-stream-layout.controlledArchiveDays), not hours — a
            // 5-day window must not collapse to ceil(5 / 24) = 1 day.
            await selectXtreamArchiveChannel({
                tvArchive: 1,
                tvArchiveDuration: 5,
            });

            const timeline = queryTimeline();
            expect(timeline.archivePlaybackAvailable()).toBe(true);
            expect(timeline.archiveDays()).toBe(5);
        });

        it('keeps the archive gate closed when the provider has no archive', async () => {
            await selectXtreamArchiveChannel({
                tvArchive: 0,
                tvArchiveDuration: 0,
            });

            const timeline = queryTimeline();
            expect(timeline.archivePlaybackAvailable()).toBe(false);
            expect(timeline.archiveDays()).toBe(0);
        });

        it('resolves the catch-up stream with epoch seconds and switches inline playback', async () => {
            portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
            streamResolver.resolveXtreamCatchupUrl.mockResolvedValue(
                'https://example.com/timeshift.m3u8'
            );
            const item = await selectXtreamArchiveChannel();
            const key = component.playbackSessionKey();

            component.onTimelineProgramActivated(timeshiftEvent());
            await fixture.whenStable();
            fixture.detectChanges();

            const program = timeshiftEvent().program;
            expect(streamResolver.resolveXtreamCatchupUrl).toHaveBeenCalledWith(
                expect.objectContaining({ xtreamId: item.xtreamId }),
                Math.floor(Date.parse(program.start) / 1000),
                Math.floor(Date.parse(program.stop) / 1000)
            );
            expect(component.inlinePlayback()?.streamUrl).toBe(
                'https://example.com/timeshift.m3u8'
            );
            expect(component.inlinePlayback()?.isLive).toBe(false);
            expect(component.playbackSessionKey()).toBe(key);
            expect(component.activeTimeshiftProgram()?.title).toBe(
                'Xtream Show'
            );
            expect(snackBar.open).not.toHaveBeenCalled();
        });

        it('shows feedback instead of failing silently when the provider rejects catch-up', async () => {
            streamResolver.resolveXtreamCatchupUrl.mockResolvedValue(null);
            await selectXtreamArchiveChannel();

            component.onTimelineProgramActivated(timeshiftEvent());
            await fixture.whenStable();

            expect(component.activeTimeshift()).toBeNull();
            expect(snackBar.open).toHaveBeenCalledTimes(1);
        });
    });

    describe('timeline channel name', () => {
        it('strips the country prefix when the setting is enabled', () => {
            stripCountryPrefix.set(true);
            component.activeDetail.set({
                epgMode: 'portal',
                playback: {
                    streamUrl: 'https://example.com/live.m3u8',
                    title: 'US | CNN',
                },
                epgItems: [],
            } as never);

            expect(component.timelineChannelName()).toBe('CNN');
        });

        it('prefers the M3U channel name and keeps it raw while disabled', () => {
            component.activeDetail.set({
                epgMode: 'm3u',
                channel: { name: 'US | CNN' },
                playback: {
                    streamUrl: 'https://example.com/live.m3u8',
                    title: 'Fallback Title',
                },
            } as never);

            expect(component.timelineChannelName()).toBe('US | CNN');
        });
    });
});
