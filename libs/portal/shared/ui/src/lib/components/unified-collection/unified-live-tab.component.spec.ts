import {
    ChangeDetectionStrategy,
    Component,
    Directive,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';
import {
    AudioPlayerComponent,
    type PlaybackFallbackRequest,
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
import {
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    EpgItem,
    EpgProgram,
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
    PORTAL_PLAYER,
    FavoritesChannelSortMode,
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';
import {
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';

@Directive({
    selector: '[appResizable]',
})
class StubResizableDirective {
    readonly minWidth = input<number>();
    readonly maxWidth = input<number>();
    readonly defaultWidth = input<number>();
    readonly storageKey = input<string>('');
}

@Component({
    selector: 'app-global-favorites-list',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubGlobalFavoritesListComponent {
    readonly channels = input.required<UnifiedFavoriteChannel[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly favoriteUids = input<ReadonlySet<string>>(new Set<string>());
    readonly epgMap = input<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = input(0);
    readonly activeUid = input<string | null>(null);
    readonly searchTermInput = input('');
    readonly draggable = input(true);
    readonly sortMode = input<FavoritesChannelSortMode>(
        DEFAULT_FAVORITES_CHANNEL_SORT_MODE
    );

    readonly channelSelected = output<UnifiedFavoriteChannel>();
    readonly channelsReordered = output<UnifiedFavoriteChannel[]>();
    readonly favoriteToggled = output<UnifiedFavoriteChannel>();
    readonly removeRequested = output<UnifiedFavoriteChannel>();
}

// Matches both live-panel selectors so the host's timeline ↔ list swap can be
// asserted by tag name; both branches share the identical contract.
@Component({
    selector: 'app-epg-timeline, app-epg-list-view',
    template: '<div class="stub-epg-timeline"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubEpgTimelineComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDays = input(0);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(true);
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly summary = input<any>(null);
    readonly summaryLabelKey = input('');
    readonly selectedDateChange = output<string>();
    readonly collapsedChange = output<boolean>();
    readonly programActivated = output<EpgProgramActivationEvent>();
    readonly returnToLive = output<void>();
}

@Component({
    selector: 'app-audio-player',
    template: '<div class="stub-audio-player"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubAudioPlayerComponent {
    readonly icon = input('');
    readonly url = input.required<string>();
    readonly channelName = input('');
}

@Component({
    selector: 'app-web-player-view',
    template: '<div class="stub-web-player-view"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubWebPlayerViewComponent {
    readonly streamUrl = input.required<string>();
    readonly title = input('');
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly playerOverride = input<VideoPlayer | null>(null);
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
}

describe('UnifiedLiveTabComponent', () => {
    let fixture: ComponentFixture<UnifiedLiveTabComponent>;
    let component: UnifiedLiveTabComponent;
    let player: ReturnType<typeof signal<VideoPlayer>>;
    let epgViewMode: ReturnType<typeof signal<'timeline' | 'list'>>;
    let stripCountryPrefix: ReturnType<typeof signal<boolean>>;
    let streamResolver: {
        resolveLiveDetail: jest.Mock;
        resolveM3uPlaybackDetail: jest.Mock;
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
            loadM3uProgramsForItem: jest.fn().mockResolvedValue([]),
            loadEpgForItems: jest.fn().mockResolvedValue(new Map()),
        };
        recentData = {
            recordLivePlayback: jest.fn(),
        };
        player = signal(VideoPlayer.VideoJs);
        epgViewMode = signal<'timeline' | 'list'>('timeline');
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
        expect(
            fixture.nativeElement.querySelector('app-vjs-player')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-html-video-player')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-art-player')
        ).toBeNull();

        webPlayer.externalFallbackRequested.emit({
            player: 'mpv',
            playback,
            diagnostic: {
                code: 'network-error',
                player: 'videojs',
                source: 'hls',
                container: '',
                mimeType: '',
                videoCodecs: [],
                audioCodecs: [],
                externalFallbackRecommended: false,
            },
        });

        expect(portalPlayer.openExternalPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'https://example.com/xtream.m3u8',
            }),
            'mpv'
        );
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

function buildLiveItem(
    sourceType: 'm3u' | 'xtream' | 'stalker'
): UnifiedCollectionItem {
    if (sourceType === 'm3u') {
        return {
            uid: 'm3u::pl-1::m3u-channel',
            name: 'M3U Live',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'pl-1',
            playlistName: 'Playlist One',
            streamUrl: 'https://example.com/m3u.m3u8',
            channelId: 'm3u-channel',
            tvgId: 'm3u-channel',
            logo: 'm3u.png',
            radio: 'false',
        };
    }

    if (sourceType === 'xtream') {
        return {
            uid: 'xtream::pl-2::20',
            name: 'Xtream Live',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'pl-2',
            playlistName: 'Playlist Two',
            xtreamId: 20,
            tvgId: '20',
            logo: 'xtream.png',
        };
    }

    return {
        uid: 'stalker::pl-3::30',
        name: 'Stalker Live',
        contentType: 'live',
        sourceType: 'stalker',
        playlistId: 'pl-3',
        playlistName: 'Playlist Three',
        stalkerId: '30',
        stalkerCmd: 'ffmpeg http://stalker/30',
        tvgId: '30',
        logo: 'stalker.png',
    };
}

function buildProgram(title: string): EpgProgram {
    return {
        start: '2026-03-26T11:00:00.000Z',
        stop: '2026-03-26T12:00:00.000Z',
        channel: 'test-channel',
        title,
        desc: `${title} description`,
        category: null,
    };
}

function buildCurrentProgram(title: string): EpgProgram {
    const now = Date.now();
    return {
        start: new Date(now - 10 * 60 * 1000).toISOString(),
        stop: new Date(now + 10 * 60 * 1000).toISOString(),
        channel: 'test-channel',
        title,
        desc: `${title} description`,
        category: null,
    };
}

function buildEpgItem(title: string): EpgItem {
    return {
        id: '1',
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: '2026-03-26T11:00:00.000Z',
        end: '2026-03-26T12:00:00.000Z',
        stop: '2026-03-26T12:00:00.000Z',
        channel_id: '1',
        start_timestamp: '1774522800',
        stop_timestamp: '1774526400',
    };
}

function buildCurrentEpgItem(title: string): EpgItem {
    const now = Date.now();
    const start = now - 10 * 60 * 1000;
    const stop = now + 10 * 60 * 1000;

    return {
        id: '1',
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: new Date(start).toISOString(),
        end: new Date(stop).toISOString(),
        stop: new Date(stop).toISOString(),
        channel_id: '1',
        start_timestamp: String(Math.floor(start / 1000)),
        stop_timestamp: String(Math.floor(stop / 1000)),
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}
