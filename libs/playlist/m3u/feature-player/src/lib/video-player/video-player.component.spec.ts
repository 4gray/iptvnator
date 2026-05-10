import { AsyncPipe } from '@angular/common';
import {
    Component,
    Directive,
    NO_ERRORS_SCHEMA,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { BehaviorSubject, of } from 'rxjs';
import {
    ChannelActions,
    selectActive,
    selectActivePlaybackUrl,
    selectChannels,
    selectChannelsLoading,
    selectCurrentEpgProgram,
} from 'm3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    LIVE_EPG_PANEL_STATE_STORAGE_KEY,
    WorkspaceHeaderContextService,
} from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService, SettingsStore } from 'services';
import { Channel, EpgProgram, Settings, VideoPlayer } from 'shared-interfaces';
import { LiveEpgPanelSummary } from 'shared-portals';
import { Overlay } from '@angular/cdk/overlay';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import type { VideoPlayerComponent as VideoPlayerComponentInstance } from './video-player.component';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

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

@Component({
    selector: 'app-channel-list-loading-state',
    standalone: true,
    template: '',
})
class StubChannelListLoadingStateComponent {
    readonly view = input<string | null>(null);
}

@Component({
    selector: 'app-sidebar',
    standalone: true,
    template: '',
})
class StubSidebarComponent {
    readonly channels = input<Channel[]>([]);
    readonly channelsLoading = input(false);
    readonly showPlaylistHeader = input(false);
    readonly activeView = input('');
    readonly sidebarWidth = input(0);
    readonly sidebarWidthRequested = output<number>();
    readonly sidebarWidthRequestEnded = output<number>();
    readonly sidebarToggleRequested = output<void>();
}

@Component({
    selector: 'app-portal-empty-state',
    standalone: true,
    template: '<div class="stub-empty-state">{{ message() }}</div>',
})
class StubPortalEmptyStateComponent {
    readonly icon = input('');
    readonly message = input('');
}

@Component({
    selector: 'app-audio-player',
    standalone: true,
    template: '',
})
class StubAudioPlayerComponent {
    readonly url = input('');
    readonly icon = input('');
    readonly channelName = input('');
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
    readonly playerOverride = input<VideoPlayer | null>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
}

@Component({
    selector: 'app-epg-list',
    standalone: true,
    template: '',
})
class StubEpgListComponent {
    readonly selectedDate = input<string | null>(null);
    readonly showDateNavigator = input(false);
    readonly archivePlaybackAvailable = input(false);
    readonly selectedDateChange = output<string>();
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
class StubResizableDirective {
    readonly minWidth = input(0);
    readonly maxWidth = input(0);
    readonly defaultWidth = input(0);
    readonly storageKey = input('');
    readonly widthChange = output<number>();
    readonly resizeEnd = output<number>();
}

describe('VideoPlayerComponent', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;
    let component: VideoPlayerComponentInstance;
    let headerContext: WorkspaceHeaderContextService;

    const playlistId = signal('playlist-1');
    const activeChannel = signal<Channel | null>(null);
    const activePlaybackUrl = signal<string | null>(null);
    const channels = signal<Channel[]>([]);
    const channelsLoading = signal(false);
    const currentEpgProgram = signal<EpgProgram | null>(null);

    const channels$ = new BehaviorSubject<Channel[]>([]);
    const activeChannel$ = new BehaviorSubject<Channel | null>(null);
    const currentEpgProgram$ = new BehaviorSubject<EpgProgram | null>(null);

    const player = signal<VideoPlayer>(VideoPlayer.VideoJs);
    const showCaptions = signal(false);

    const overlayRef = {
        attach: jest.fn().mockReturnValue({ instance: {} }),
        backdropClick: jest.fn().mockReturnValue(of(undefined)),
        dispose: jest.fn(),
    };
    const positionStrategy = {
        centerHorizontally: jest.fn().mockReturnThis(),
        centerVertically: jest.fn().mockReturnThis(),
    };
    const overlayMock = {
        position: jest.fn().mockReturnValue({
            global: jest.fn().mockReturnValue(positionStrategy),
        }),
        create: jest.fn().mockReturnValue(overlayRef),
    };

    const storeMock = {
        dispatch: jest.fn(),
        selectSignal: jest.fn((selector: unknown) => {
            switch (selector) {
                case selectActive:
                    return activeChannel;
                case selectActivePlaybackUrl:
                    return activePlaybackUrl;
                case selectChannels:
                    return channels;
                case selectChannelsLoading:
                    return channelsLoading;
                case selectCurrentEpgProgram:
                    return currentEpgProgram;
                default:
                    return signal(null);
            }
        }),
        select: jest.fn((selector: unknown) => {
            switch (selector) {
                case selectChannels:
                    return channels$.asObservable();
                case selectActive:
                    return activeChannel$.asObservable();
                case selectCurrentEpgProgram:
                    return currentEpgProgram$.asObservable();
                default:
                    return of(null);
            }
        }),
    };

    const routerMock = {
        url: '/workspace/playlists/playlist-1/all',
        navigate: jest.fn(),
        currentNavigation: jest.fn().mockReturnValue(null),
    };

    const playlistsServiceMock = {
        getPlaylist: jest.fn(() =>
            of({
                playlist: {
                    items: channels(),
                },
                favorites: [],
            })
        ),
        getPlaylistWithGlobalFavorites: jest.fn(() =>
            of({
                playlist: {
                    items: [],
                },
                favorites: [],
            })
        ),
        addM3uRecentlyViewed: jest.fn(() =>
            of({
                recentlyViewed: [],
            })
        ),
    };
    const dataServiceMock = {
        sendIpcEvent: jest.fn(),
    };

    const sampleChannel: Channel = {
        id: 'channel-1',
        url: 'http://localhost/live.m3u8',
        name: 'Sample TV',
        epgParams: '',
        radio: 'false',
        tvg: {
            id: 'sample-tvg-id',
            logo: 'http://localhost/logo.png',
            name: 'Sample TV',
        },
    } as Channel;

    beforeAll(async () => {
        ({ VideoPlayerComponent } = await import('./video-player.component'));
    });

    function syncStoreState(channel: Channel | null): void {
        activeChannel.set(channel);
        activeChannel$.next(channel);
        channels.set(channel ? [channel] : []);
        channels$.next(channel ? [channel] : []);
    }

    beforeEach(async () => {
        syncStoreState(null);
        localStorage.removeItem('m3u-sidebar-width');
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        player.set(VideoPlayer.VideoJs);
        showCaptions.set(false);
        activePlaybackUrl.set(null);
        channelsLoading.set(false);
        currentEpgProgram.set(null);
        currentEpgProgram$.next(null);
        overlayMock.create.mockClear();
        overlayRef.attach.mockClear();
        overlayRef.dispose.mockClear();
        storeMock.dispatch.mockClear();
        dataServiceMock.sendIpcEvent.mockClear();

        await TestBed.configureTestingModule({
            imports: [VideoPlayerComponent],
            schemas: [NO_ERRORS_SCHEMA],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        params: of({ id: playlistId(), view: 'all' }),
                        queryParams: of({}),
                        snapshot: {
                            data: { layout: 'workspace' },
                            queryParams: {},
                        },
                    },
                },
                {
                    provide: Router,
                    useValue: routerMock,
                },
                {
                    provide: Store,
                    useValue: storeMock,
                },
                {
                    provide: Overlay,
                    useValue: overlayMock,
                },
                {
                    provide: DataService,
                    useValue: dataServiceMock,
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsServiceMock,
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        resolvedPlaylistId: playlistId,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        player,
                        showCaptions,
                    },
                },
                {
                    provide: StorageMap,
                    useValue: {
                        get: jest.fn(() =>
                            of({
                                player: player(),
                                showCaptions: showCaptions(),
                            } as Partial<Settings>)
                        ),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal(null),
                    },
                },
            ],
        })
            .overrideComponent(VideoPlayerComponent, {
                set: {
                    imports: [
                        AsyncPipe,
                        StubAudioPlayerComponent,
                        StubChannelListLoadingStateComponent,
                        StubEpgListComponent,
                        StubLiveEpgPanelComponent,
                        StubPortalEmptyStateComponent,
                        StubResizableDirective,
                        StubSidebarComponent,
                        StubWebPlayerViewComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        headerContext = TestBed.inject(WorkspaceHeaderContextService);
    });

    afterEach(() => {
        fixture?.destroy();
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
    });

    it('registers and clears the workspace multi-EPG header shortcut', () => {
        fixture.detectChanges();

        expect(headerContext.action()).toEqual(
            expect.objectContaining({
                id: 'm3u-multi-epg',
                icon: 'view_list',
            })
        );

        fixture.destroy();
        expect(headerContext.action()).toBeNull();
    });

    it('renders the inline player with the embedded EPG panel', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.video-player')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-web-player-view')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
    });

    it('opens MPV fallback with the active channel headers preserved', () => {
        syncStoreState({
            ...sampleChannel,
            http: {
                'user-agent': 'IPTVnator Test',
                referrer: 'https://referrer.example.com',
                origin: 'https://origin.example.com',
            },
        } as Channel);

        component.handleExternalFallbackRequest({
            player: 'mpv',
            playback: {
                streamUrl: 'https://archive.example.com/live.m3u8?utc=1',
                title: 'Archive Sample',
            },
            diagnostic: {
                code: 'unsupported-codec',
                source: 'hls',
                sourceUrl: 'https://archive.example.com/live.m3u8?utc=1',
                container: 'm3u8',
                audioCodecs: ['ac-3'],
                videoCodecs: ['avc1.64001f'],
                externalFallbackRecommended: true,
            },
        } satisfies PlaybackFallbackRequest);

        expect(dataServiceMock.sendIpcEvent).toHaveBeenCalledWith(
            'OPEN_MPV_PLAYER',
            expect.objectContaining({
                url: 'https://archive.example.com/live.m3u8?utc=1',
                title: 'Sample TV',
                'user-agent': 'IPTVnator Test',
                referer: 'https://referrer.example.com',
                origin: 'https://origin.example.com',
            })
        );
    });

    it('renders the embedded mpv inline player with the EPG panel', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.EmbeddedMpv);

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.video-player')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-web-player-view')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
    });

    it('renders only the EPG panel when an external player is configured', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.MPV);

        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.video-player')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-live-epg-panel')
        ).toBeNull();
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                ?.classList.contains('epg-collapsed')
        ).toBe(false);
    });

    it('restores the collapsed live EPG panel state for inline playback', () => {
        fixture.destroy();
        localStorage.setItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY, 'collapsed');

        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        headerContext = TestBed.inject(WorkspaceHeaderContextService);
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);

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

    it('renders the current EPG program summary for the inline panel', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        currentEpgProgram.set(buildProgram('Current Show'));
        currentEpgProgram$.next(buildProgram('Current Show'));

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.live-epg-panel-summary')
                .textContent
        ).toContain('Current Show');
    });

    it('uses the active playback override url when archive playback is active', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        activePlaybackUrl.set('http://localhost/archive.m3u8?utc=123&lutc=456');

        fixture.detectChanges();

        expect(component.playbackChannel()?.url).toBe(
            'http://localhost/archive.m3u8?utc=123&lutc=456'
        );

        activePlaybackUrl.set(null);
        fixture.detectChanges();

        expect(component.playbackChannel()?.url).toBe(sampleChannel.url);
    });

    it('updates the outer sidebar width while grouped view requests a larger total width', () => {
        fixture.detectChanges();

        component.onGroupedSidebarWidthRequested(540);
        fixture.detectChanges();

        const sidebar = fixture.nativeElement.querySelector(
            '.sidebar'
        ) as HTMLElement | null;

        expect(sidebar?.style.width).toBe('540px');
    });

    it('uses the single-pane sidebar key for all-channel view instead of the groups total key', () => {
        fixture.destroy();

        localStorage.setItem('m3u-sidebar-width', '320');
        localStorage.setItem('m3u-groups-sidebar-width', '560');

        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        headerContext = TestBed.inject(WorkspaceHeaderContextService);

        fixture.detectChanges();

        const sidebar = fixture.nativeElement.querySelector(
            '.sidebar'
        ) as HTMLElement | null;

        expect(sidebar?.style.width).toBe('320px');
    });

    it('tracks manual sidebar resize and persists the committed width', () => {
        fixture.detectChanges();

        component.onSidebarWidthChange(420);
        fixture.detectChanges();

        const sidebar = fixture.nativeElement.querySelector(
            '.sidebar'
        ) as HTMLElement | null;

        expect(sidebar?.style.width).toBe('420px');

        component.onSidebarResizeEnd(420);

        expect(localStorage.getItem('m3u-sidebar-width')).toBe('420');
    });

    it('clamps and persists grouped-view sidebar width requests on resize end', () => {
        fixture.detectChanges();

        component.onGroupedSidebarWidthRequestEnded(640);
        fixture.detectChanges();

        const sidebar = fixture.nativeElement.querySelector(
            '.sidebar'
        ) as HTMLElement | null;

        expect(sidebar?.style.width).toBe('600px');
        expect(localStorage.getItem('m3u-sidebar-width')).toBe('600');
    });

    it('renders the shared empty state when no channel is active', () => {
        fixture.detectChanges();

        const emptyState = fixture.nativeElement.querySelector(
            'app-portal-empty-state'
        ) as HTMLElement | null;

        expect(emptyState).not.toBeNull();
        expect(emptyState?.textContent).toContain(
            'CHANNELS.SELECT_CHANNEL_PLAYBACK'
        );
    });

    it('reuses the registered header shortcut callback to open multi EPG', () => {
        fixture.detectChanges();

        headerContext.action()?.run();

        expect(overlayMock.create).toHaveBeenCalledTimes(1);
        expect(overlayRef.attach).toHaveBeenCalledTimes(1);
    });

    it('switches channels by number through a playback request', () => {
        syncStoreState(sampleChannel);
        fixture.detectChanges();

        component.switchToChannelByNumber(1);

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({
                channel: sampleChannel,
                startPlayback: true,
            })
        );
    });

    it('changes channels from remote navigation through a playback request', () => {
        const nextChannel = {
            ...sampleChannel,
            id: 'channel-2',
            url: 'http://localhost/next.m3u8',
            name: 'Next TV',
        };
        activeChannel.set(sampleChannel);
        activeChannel$.next(sampleChannel);
        channels.set([sampleChannel, nextChannel]);
        channels$.next([sampleChannel, nextChannel]);
        fixture.detectChanges();

        (
            component as unknown as {
                handleRemoteChannelChange(direction: 'up' | 'down'): void;
            }
        ).handleRemoteChannelChange('down');

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({
                channel: nextChannel,
                startPlayback: true,
            })
        );
    });
});

function buildProgram(title: string): EpgProgram {
    return {
        start: '2026-04-05T11:30:00.000Z',
        stop: '2026-04-05T12:30:00.000Z',
        channel: 'sample-tvg-id',
        title,
        desc: null,
        category: null,
        startTimestamp: 1775388600,
        stopTimestamp: 1775392200,
    };
}
