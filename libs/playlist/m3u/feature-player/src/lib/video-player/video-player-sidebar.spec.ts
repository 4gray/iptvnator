import { AsyncPipe } from '@angular/common';
import { Component, NO_ERRORS_SCHEMA, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Overlay } from '@angular/cdk/overlay';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { BehaviorSubject, of } from 'rxjs';
import {
    selectActive,
    selectActiveEpgProgram,
    selectActivePlaybackUrl,
    selectChannels,
    selectChannelsLoading,
    selectCurrentEpgProgram,
} from '@iptvnator/m3u-state';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    LiveLayoutSidebarStateService,
    liveSidebarStateStorageKey,
    PORTAL_EXTERNAL_PLAYBACK,
} from '@iptvnator/portal/shared/util';
import {
    DataService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import {
    Channel,
    EpgProgram,
    Settings,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { VideoPlayerComponent as VideoPlayerComponentInstance } from './video-player.component';

// The component's chain reaches video.js (ui/playback → VjsPlayer); the CJS
// bundle breaks under the ESM jest environment, so it is mocked before the
// dynamic import evaluates the chain.
jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({
    selector: 'app-channel-list-hidden-state',
    standalone: true,
    template: '',
})
class StubChannelListHiddenStateComponent {
    readonly restore = output<void>();
}

/**
 * The collapsible channels rail of the M3U player. Separate from
 * `video-player.component.spec.ts` only because that file sits at the
 * max-lines test budget; the harness here is the minimal subset needed to
 * render the rail and the content-area empty states.
 */
describe('VideoPlayerComponent — collapsible channels rail', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;
    let component: VideoPlayerComponentInstance;
    let sidebarState: LiveLayoutSidebarStateService;

    const playlistId = signal('playlist-1');
    const activeChannel = signal<Channel | null>(null);
    const activePlaybackUrl = signal<string | null>(null);
    const channels = signal<Channel[]>([]);
    const channelsLoading = signal(false);
    const currentEpgProgram = signal<EpgProgram | null>(null);
    const activeEpgProgram = signal<EpgProgram | null>(null);
    const channels$ = new BehaviorSubject<Channel[]>([]);
    const activeChannel$ = new BehaviorSubject<Channel | null>(null);
    const currentEpgProgram$ = new BehaviorSubject<EpgProgram | null>(null);
    const epgPrograms$ = new BehaviorSubject<EpgProgram[]>([]);

    const player = signal<VideoPlayer>(VideoPlayer.VideoJs);
    const showCaptions = signal(false);
    const stripCountryPrefix = signal(false);

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
                case selectActiveEpgProgram:
                    return activeEpgProgram;
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

    function clearSidebarStorage(): void {
        localStorage.removeItem(liveSidebarStateStorageKey('m3u'));
        localStorage.removeItem(liveSidebarStateStorageKey('portal'));
        localStorage.removeItem(liveSidebarStateStorageKey('collection'));
    }

    function query(selector: string): Element | null {
        return fixture.nativeElement.querySelector(selector);
    }

    function hiddenState() {
        return fixture.debugElement.query(
            By.directive(StubChannelListHiddenStateComponent)
        );
    }

    beforeAll(async () => {
        ({ VideoPlayerComponent } = await import('./video-player.component'));
    });

    beforeEach(async () => {
        clearSidebarStorage();
        activeChannel.set(null);
        activeChannel$.next(null);
        channels.set([]);
        channels$.next([]);

        await TestBed.configureTestingModule({
            imports: [VideoPlayerComponent],
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
                    useValue: {
                        url: '/workspace/playlists/playlist-1/all',
                        navigate: jest.fn(),
                        currentNavigation: jest.fn().mockReturnValue(null),
                    },
                },
                { provide: Store, useValue: storeMock },
                {
                    provide: Overlay,
                    useValue: { position: jest.fn(), create: jest.fn() },
                },
                { provide: DataService, useValue: { sendIpcEvent: jest.fn() } },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: true,
                        isElectron: false,
                        supportsRemoteControl: false,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylist: jest.fn(() =>
                            of({ playlist: { items: [] }, favorites: [] })
                        ),
                        getPlaylistWithGlobalFavorites: jest.fn(() =>
                            of({ playlist: { items: [] }, favorites: [] })
                        ),
                        addM3uRecentlyViewed: jest.fn(() =>
                            of({ recentlyViewed: [] })
                        ),
                    },
                },
                {
                    provide: EpgService,
                    useValue: {
                        currentEpgPrograms$: epgPrograms$.asObservable(),
                        getChannelMetadataForChannels: () => of(new Map()),
                    },
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: { resolvedPlaylistId: playlistId },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        player,
                        showCaptions,
                        stripCountryPrefix,
                        m3uVodDetails: signal(true),
                        resolvedEpgViewMode: signal('timeline'),
                        epgUrl: signal<string[]>([]),
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
                    useValue: { activeSession: signal(null) },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled: () => true },
                },
            ],
        })
            // The rail and the content-area empty states are the subject;
            // everything else renders as inert unknown elements.
            .overrideComponent(VideoPlayerComponent, {
                set: {
                    imports: [
                        AsyncPipe,
                        StubChannelListHiddenStateComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                    schemas: [NO_ERRORS_SCHEMA],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        sidebarState = TestBed.inject(LiveLayoutSidebarStateService);
    });

    afterEach(() => {
        fixture?.destroy();
        clearSidebarStorage();
    });

    it('starts with the rail visible and the "select a channel" empty state', () => {
        fixture.detectChanges();

        expect(component.isSidebarCollapsed()).toBe(false);
        expect(query('.sidebar')?.classList.contains('sidebar-collapsed')).toBe(
            false
        );
        expect(query('.sidebar-restore')).toBeNull();
        expect(query('app-portal-empty-state')).not.toBeNull();
        expect(hiddenState()).toBeNull();
    });

    it('hides the rail through the shared per-surface state and swaps the empty state for a full-size way back', () => {
        fixture.detectChanges();

        component.toggleSidebar();
        fixture.detectChanges();

        expect(component.isSidebarCollapsed()).toBe(true);
        expect(query('.sidebar')?.classList.contains('sidebar-collapsed')).toBe(
            true
        );
        expect(query('.sidebar-restore')).not.toBeNull();
        expect(query('app-portal-empty-state')).toBeNull();
        expect(hiddenState()).not.toBeNull();
        expect(localStorage.getItem(liveSidebarStateStorageKey('m3u'))).toBe(
            'collapsed'
        );

        hiddenState().componentInstance.restore.emit();
        fixture.detectChanges();

        expect(component.isSidebarCollapsed()).toBe(false);
        expect(query('.sidebar-restore')).toBeNull();
        expect(hiddenState()).toBeNull();
        expect(query('app-portal-empty-state')).not.toBeNull();
        expect(localStorage.getItem(liveSidebarStateStorageKey('m3u'))).toBe(
            'expanded'
        );
    });

    it('reflects a toggle made elsewhere for the M3U surface (the header) and ignores other surfaces', () => {
        fixture.detectChanges();

        sidebarState.setState('portal', 'collapsed');
        sidebarState.setState('collection', 'collapsed');
        fixture.detectChanges();

        expect(component.isSidebarCollapsed()).toBe(false);
        expect(query('.sidebar-restore')).toBeNull();

        sidebarState.toggle('m3u');
        fixture.detectChanges();

        expect(component.isSidebarCollapsed()).toBe(true);
        expect(query('.sidebar-restore')).not.toBeNull();
    });

    it('does not show the hidden-list state while a channel is playing', () => {
        const liveChannel = {
            id: 'channel-1',
            url: 'http://localhost/live.m3u8',
            name: 'Sample TV',
            epgParams: '',
            radio: 'false',
            tvg: { id: '', logo: '', name: 'Sample TV' },
        } as Channel;
        activeChannel.set(liveChannel);
        activeChannel$.next(liveChannel);
        channels.set([liveChannel]);
        channels$.next([liveChannel]);
        fixture.detectChanges();

        component.toggleSidebar();
        fixture.detectChanges();

        expect(component.isSidebarCollapsed()).toBe(true);
        expect(query('.sidebar-restore')).not.toBeNull();
        expect(hiddenState()).toBeNull();
        expect(query('.video-player')).not.toBeNull();
    });
});
