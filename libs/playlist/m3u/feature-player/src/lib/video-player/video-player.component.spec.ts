import { AsyncPipe } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
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
    selectChannels,
    selectCurrentEpgProgram,
} from 'm3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    WorkspaceHeaderContextService,
} from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService, SettingsStore } from 'services';
import {
    Channel,
    Settings,
    VideoPlayer,
} from 'shared-interfaces';
import { Overlay } from '@angular/cdk/overlay';
import { VideoPlayerComponent } from './video-player.component';

describe('VideoPlayerComponent', () => {
    let fixture: ComponentFixture<VideoPlayerComponent>;
    let component: VideoPlayerComponent;
    let headerContext: WorkspaceHeaderContextService;

    const playlistId = signal('playlist-1');
    const activeChannel = signal<Channel | null>(null);
    const channels = signal<Channel[]>([]);
    const currentEpgProgram = signal(null);

    const channels$ = new BehaviorSubject<Channel[]>([]);
    const activeChannel$ = new BehaviorSubject<Channel | null>(null);
    const currentEpgProgram$ = new BehaviorSubject(null);

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
                case selectChannels:
                    return channels;
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

    function syncStoreState(channel: Channel | null): void {
        activeChannel.set(channel);
        activeChannel$.next(channel);
        channels.set(channel ? [channel] : []);
        channels$.next(channel ? [channel] : []);
    }

    beforeEach(async () => {
        syncStoreState(null);
        localStorage.removeItem('m3u-sidebar-width');
        player.set(VideoPlayer.VideoJs);
        showCaptions.set(false);
        currentEpgProgram.set(null);
        currentEpgProgram$.next(null);
        overlayMock.create.mockClear();
        overlayRef.attach.mockClear();
        overlayRef.dispose.mockClear();
        storeMock.dispatch.mockClear();

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
                    useValue: {
                        sendIpcEvent: jest.fn(),
                    },
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
        fixture.destroy();
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
            fixture.nativeElement.querySelector('app-vjs-player')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
    });

    it('renders only the EPG panel when an external player is configured', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.MPV);

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.video-player')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
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

    it('switches channels by number through the store action', () => {
        syncStoreState(sampleChannel);
        fixture.detectChanges();

        component.switchToChannelByNumber(1);

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({ channel: sampleChannel })
        );
    });
});
