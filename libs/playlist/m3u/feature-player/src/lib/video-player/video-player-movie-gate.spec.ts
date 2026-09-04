import { AsyncPipe } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
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

/**
 * The M3U movie recognition gate: which channels swap the player + EPG zone
 * for the VOD detail host. Separate from `video-player.component.spec.ts`
 * only because that file sits at the max-lines test budget; the harness here
 * is the minimal subset needed to render the layout branch.
 */
describe('VideoPlayerComponent — M3U movie recognition gate', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;
    let component: VideoPlayerComponentInstance;

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
    const m3uVodDetails = signal<boolean | undefined>(true);
    const tmdbEnabled = signal(true);

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

    const liveChannel: Channel = {
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

    const movieChannel: Channel = {
        ...liveChannel,
        id: 'movie-1',
        name: 'Dune (2021) 1080p',
        url: 'http://host/movie/user/pass/1.mkv',
        tvg: { ...liveChannel.tvg, id: '' },
    };

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
        m3uVodDetails.set(true);
        tmdbEnabled.set(true);

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
                        m3uVodDetails,
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
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
                    useValue: { isEnabled: () => tmdbEnabled() },
                },
            ],
        })
            // The layout branch is the subject; everything below it renders
            // as inert unknown elements.
            .overrideComponent(VideoPlayerComponent, {
                set: {
                    imports: [
                        AsyncPipe,
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
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('routes a recognized movie to the VOD detail host instead of the EPG zone', () => {
        syncStoreState(movieChannel);
        fixture.detectChanges();

        expect(component.showMovieDetail()).toBe(true);
        expect(
            fixture.nativeElement.querySelector('app-m3u-vod-detail')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.epg')).toBeNull();
        expect(fixture.nativeElement.querySelector('.video-player')).toBeNull();
    });

    it('keeps the live layout for a live channel', () => {
        syncStoreState(liveChannel);
        fixture.detectChanges();

        expect(component.showMovieDetail()).toBe(false);
        expect(
            fixture.nativeElement.querySelector('app-m3u-vod-detail')
        ).toBeNull();
        expect(fixture.nativeElement.querySelector('.epg')).not.toBeNull();
    });

    it('stays off when the settings toggle is disabled', () => {
        m3uVodDetails.set(false);
        syncStoreState(movieChannel);
        fixture.detectChanges();

        expect(component.showMovieDetail()).toBe(false);
        expect(
            fixture.nativeElement.querySelector('app-m3u-vod-detail')
        ).toBeNull();
        expect(fixture.nativeElement.querySelector('.epg')).not.toBeNull();
    });

    it('stays off while TMDB enrichment is not enabled', () => {
        tmdbEnabled.set(false);
        syncStoreState(movieChannel);
        fixture.detectChanges();

        expect(component.showMovieDetail()).toBe(false);
    });

    it('treats a missing toggle value as enabled (default on)', () => {
        m3uVodDetails.set(undefined);
        syncStoreState(movieChannel);
        fixture.detectChanges();

        expect(component.showMovieDetail()).toBe(true);
    });

    describe('volume handed to each new player', () => {
        afterEach(() => localStorage.removeItem('volume'));

        it('re-reads the shared volume bus on every channel change', () => {
            localStorage.setItem('volume', '0.4');
            syncStoreState(movieChannel);
            fixture.detectChanges();
            expect(component.volume()).toBe(0.4);

            // The engines persist straight to localStorage and never call
            // back, so a volume set inside the player is only visible there.
            localStorage.setItem('volume', '0.15');
            syncStoreState(liveChannel);
            fixture.detectChanges();

            expect(component.volume()).toBe(0.15);
        });

        it.each(['not-a-number', '', '  ', '5', '-1'])(
            'falls back to full volume for the stored value %p',
            (stored) => {
                localStorage.setItem('volume', stored);
                syncStoreState(movieChannel);
                fixture.detectChanges();

                expect(component.volume()).toBe(1);
            }
        );

        it('falls back to full volume when nothing is stored yet', () => {
            localStorage.removeItem('volume');
            syncStoreState(movieChannel);
            fixture.detectChanges();

            // `Number(null)` is 0 — a first run must not start muted.
            expect(component.volume()).toBe(1);
        });

        it('keeps a stored silence', () => {
            localStorage.setItem('volume', '0');
            syncStoreState(movieChannel);
            fixture.detectChanges();

            expect(component.volume()).toBe(0);
        });

        it('refreshes from the bus when the detail host remounts the player', () => {
            localStorage.setItem('volume', '0.9');
            syncStoreState(movieChannel);
            fixture.detectChanges();
            expect(component.volume()).toBe(0.9);

            // Engine-side change during playback, then Browse → Play on the
            // SAME channel: no channel change, so only this call refreshes.
            localStorage.setItem('volume', '0.25');
            component.refreshVolumeFromBus();

            expect(component.volume()).toBe(0.25);
        });

        it('re-reads even when the next entry shares the previous id', () => {
            // `createChannel` falls back to the URL for the id, so one stream
            // listed under two groups yields two entries with the same id.
            // Pins the user-visible guarantee independently of what the
            // linkedSignal source happens to derive.
            localStorage.setItem('volume', '0.8');
            syncStoreState(movieChannel);
            fixture.detectChanges();
            expect(component.volume()).toBe(0.8);

            localStorage.setItem('volume', '0.2');
            syncStoreState({ ...movieChannel, group: { title: 'New' } });
            fixture.detectChanges();

            expect(component.volume()).toBe(0.2);
        });
    });
});
