import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import {
    ChannelActions,
    selectActive,
    selectActivePlaylist,
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
    ExternalPlayerSession,
    PlaylistMeta,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { VideoPlayerComponent as VideoPlayerComponentInstance } from './video-player.component';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

/**
 * Fullscreen channel panel host contract and keyboard zapping of the M3U
 * player. Kept apart from `video-player.component.spec.ts`, which sits at the
 * spec line budget; the template is reduced to the panel's `ng-template` so
 * no child stubs are needed.
 */
describe('VideoPlayerComponent fullscreen channel panel + zapping', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;
    let component: VideoPlayerComponentInstance;

    const sampleChannel = {
        id: 'channel-1',
        url: 'http://localhost/live.m3u8',
        name: 'Sample TV',
        radio: 'false',
    } as Channel;
    const nextChannel = {
        ...sampleChannel,
        id: 'channel-2',
        url: 'http://localhost/next.m3u8',
        name: 'Next TV',
    } as Channel;

    const activeChannel = signal<Channel | null>(sampleChannel);
    const channels = signal<Channel[]>([sampleChannel, nextChannel]);
    const activePlaylistMeta = signal<PlaylistMeta | null>(null);
    const fullscreenChannelPanelSetting = signal<boolean | undefined>(
        undefined
    );
    const tmdbEnabled = signal(false);
    const player = signal(VideoPlayer.VideoJs);
    const movieChannel = {
        id: 'movie-1',
        url: 'http://localhost/movies/the-film.mkv',
        name: 'The Film (2019)',
    } as Channel;
    const channels$ = new BehaviorSubject<Channel[]>([
        sampleChannel,
        nextChannel,
    ]);
    const activeChannel$ = new BehaviorSubject<Channel | null>(sampleChannel);

    const storeMock = {
        dispatch: jest.fn(),
        selectSignal: jest.fn((selector: unknown) => {
            switch (selector) {
                case selectActive:
                    return activeChannel;
                case selectChannels:
                    return channels;
                case selectChannelsLoading:
                    return signal(false);
                case selectActivePlaylist:
                    return activePlaylistMeta;
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
                    return of(null);
                default:
                    return of(null);
            }
        }),
    };

    const setActive = (channel: Channel) => {
        activeChannel.set(channel);
        activeChannel$.next(channel);
    };

    const setActiveChannelDispatch = (channel: Channel) =>
        ChannelActions.setActiveChannel({ channel, startPlayback: true });

    beforeAll(async () => {
        ({ VideoPlayerComponent } = await import('./video-player.component'));
    });

    beforeEach(async () => {
        storeMock.dispatch.mockClear();
        setActive(sampleChannel);
        channels.set([sampleChannel, nextChannel]);
        channels$.next([sampleChannel, nextChannel]);
        activePlaylistMeta.set(null);
        fullscreenChannelPanelSetting.set(undefined);
        tmdbEnabled.set(false);
        player.set(VideoPlayer.VideoJs);

        await TestBed.configureTestingModule({
            imports: [VideoPlayerComponent],
            schemas: [NO_ERRORS_SCHEMA],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        params: of({ id: 'playlist-1', view: 'all' }),
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
                    // The component provides `M3uEpgGuideSourceService`,
                    // which resolves its scope labels through this service.
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        onLangChange: EMPTY,
                    },
                },
                { provide: DataService, useValue: { sendIpcEvent: jest.fn() } },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: false,
                        isElectron: false,
                        supportsRemoteControl: false,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylist: jest.fn(() =>
                            of({
                                playlist: { items: channels() },
                                favorites: [],
                            })
                        ),
                        addM3uRecentlyViewed: jest.fn(() =>
                            of({ recentlyViewed: [] })
                        ),
                    },
                },
                {
                    provide: EpgService,
                    useValue: {
                        currentEpgPrograms$: of([] as EpgProgram[]),
                        getChannelMetadataForChannels: () => of(new Map()),
                    },
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        resolvedPlaylistId: signal('playlist-1'),
                        activePlaylist: signal(null),
                    },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled: () => tmdbEnabled() },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        player,
                        showCaptions: signal(false),
                        stripCountryPrefix: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                        epgUrl: signal<string[]>([]),
                        fullscreenChannelPanel: fullscreenChannelPanelSetting,
                    },
                },
                {
                    provide: StorageMap,
                    useValue: {
                        get: jest.fn(() => of({ player: VideoPlayer.VideoJs })),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal<ExternalPlayerSession | null>(
                            null
                        ),
                    },
                },
            ],
        })
            .overrideComponent(VideoPlayerComponent, {
                set: {
                    imports: [],
                    template:
                        '<ng-template #fullscreenChannelPanel></ng-template>',
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        storeMock.dispatch.mockClear();
    });

    afterEach(() => {
        fixture.destroy();
    });

    describe('FULLSCREEN_CHANNEL_PANEL host', () => {
        it.each([VideoPlayer.MPV, VideoPlayer.VLC])(
            'withholds rows that would leave forced-inline DASH for %s',
            (externalPlayer) => {
                const dashChannel = {
                    ...sampleChannel,
                    url: 'http://localhost/live.mpd',
                };
                const nextDashChannel = {
                    ...nextChannel,
                    url: 'http://localhost/next.mpd',
                };
                player.set(externalPlayer);
                component.playerSettings.player = externalPlayer;
                setActive(dashChannel);
                channels.set([dashChannel, sampleChannel, nextDashChannel]);

                expect(component.shouldShowInlinePlayer(dashChannel)).toBe(
                    true
                );
                expect(component.panelTemplate()).not.toBeNull();
                expect(component.fullscreenPanelChannels()).toEqual([
                    dashChannel,
                    nextDashChannel,
                ]);
                expect(component.channels()).toHaveLength(3);

                player.set(VideoPlayer.Html5Player);
                expect(component.fullscreenPanelChannels()).toHaveLength(3);
            }
        );

        it('offers the panel template unless the preference is switched off', () => {
            expect(component.panelTemplate()).not.toBeNull();

            fullscreenChannelPanelSetting.set(false);
            expect(component.panelTemplate()).toBeNull();

            fullscreenChannelPanelSetting.set(true);
            expect(component.panelTemplate()).not.toBeNull();
        });

        it('withholds the panel while the VOD detail hosts the player', () => {
            tmdbEnabled.set(true);
            setActive(movieChannel);
            fixture.detectChanges();

            expect(component.showMovieDetail()).toBe(true);
            expect(component.panelTemplate()).toBeNull();

            setActive(sampleChannel);
            fixture.detectChanges();
            expect(component.showMovieDetail()).toBe(false);
            expect(component.panelTemplate()).not.toBeNull();
        });

        it('titles the panel with the playlist name', () => {
            expect(component.panelTitle()).toBe('');

            activePlaylistMeta.set({ title: 'Living Room' } as PlaylistMeta);
            expect(component.panelTitle()).toBe('Living Room');
        });

        it('withholds radio stations from the panel list', () => {
            // A radio row plays through app-audio-player, which replaces the
            // app-web-player-view that owns fullscreen — picking one would
            // drop the user out of the mode the panel exists to keep.
            const radioChannel = {
                ...sampleChannel,
                id: 'radio-1',
                url: 'http://localhost/radio.mp3',
                name: 'Sample FM',
                radio: 'true',
            } as Channel;
            channels.set([sampleChannel, radioChannel, nextChannel]);

            expect(component.fullscreenPanelChannels()).toEqual([
                sampleChannel,
                nextChannel,
            ]);
            // The page's own sidebar still lists every channel.
            expect(component.channels()).toHaveLength(3);
        });
    });

    describe('fullscreen panel rows', () => {
        it('withholds recognized movies only while they would open the VOD detail', () => {
            // With enrichment on, a movie row swaps the live layout for the
            // VOD detail shell, which replaces the fullscreen-owning player —
            // the same trap as radio. With enrichment off it plays inline
            // like any live entry and stays offered.
            channels.set([sampleChannel, movieChannel, nextChannel]);

            tmdbEnabled.set(true);
            expect(component.fullscreenPanelChannels()).toEqual([
                sampleChannel,
                nextChannel,
            ]);

            tmdbEnabled.set(false);
            expect(component.fullscreenPanelChannels()).toEqual([
                sampleChannel,
                movieChannel,
                nextChannel,
            ]);
        });
    });

    describe('PageUp/PageDown zapping', () => {
        it.each([VideoPlayer.MPV, VideoPlayer.VLC])(
            'keeps numeric and adjacent selections inline in fullscreen with %s',
            (externalPlayer) => {
                const first = {
                    ...sampleChannel,
                    url: 'http://localhost/first.mpd',
                };
                const last = {
                    ...nextChannel,
                    url: 'http://localhost/last.mpd',
                };
                const catalog = [first, sampleChannel, last];
                player.set(externalPlayer);
                channels.set(catalog);
                channels$.next(catalog);
                setActive(first);
                const stage = document.createElement('app-web-player-view');
                fixture.nativeElement.appendChild(stage);
                let fullscreen: Element | null = stage;
                const descriptor = Object.getOwnPropertyDescriptor(
                    document,
                    'fullscreenElement'
                );
                Object.defineProperty(document, 'fullscreenElement', {
                    configurable: true,
                    get: () => fullscreen,
                });
                try {
                    component.switchToChannelByNumber(2);
                    expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                        setActiveChannelDispatch(sampleChannel)
                    );
                    component.switchToChannelByNumber(3);
                    expect(storeMock.dispatch).toHaveBeenCalledWith(
                        setActiveChannelDispatch(last)
                    );

                    storeMock.dispatch.mockClear();
                    component.handleRemoteChannelChange('down');
                    expect(storeMock.dispatch).toHaveBeenCalledWith(
                        setActiveChannelDispatch(last)
                    );
                    expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                        setActiveChannelDispatch(sampleChannel)
                    );

                    fullscreen = null;
                    storeMock.dispatch.mockClear();
                    component.switchToChannelByNumber(2);
                    expect(storeMock.dispatch).toHaveBeenCalledWith(
                        setActiveChannelDispatch(sampleChannel)
                    );
                } finally {
                    if (descriptor)
                        Object.defineProperty(
                            document,
                            'fullscreenElement',
                            descriptor
                        );
                    else Reflect.deleteProperty(document, 'fullscreenElement');
                }
            }
        );

        it('treats a legacy player fullscreening its nested surface as the live host owning fullscreen', () => {
            // Vendor-chrome opt-out: Video.js/ArtPlayer fullscreen their own
            // element inside app-web-player-view, not the host itself, and
            // leaving fullscreen through an ineligible channel is the same
            // loss there.
            const first = {
                ...sampleChannel,
                url: 'http://localhost/first.mpd',
            };
            const catalog = [first, sampleChannel];
            player.set(VideoPlayer.MPV);
            channels.set(catalog);
            channels$.next(catalog);
            setActive(first);
            const stage = document.createElement('app-web-player-view');
            const legacySurface = document.createElement('div');
            legacySurface.className = 'video-js';
            stage.appendChild(legacySurface);
            fixture.nativeElement.appendChild(stage);
            const descriptor = Object.getOwnPropertyDescriptor(
                document,
                'fullscreenElement'
            );
            Object.defineProperty(document, 'fullscreenElement', {
                configurable: true,
                get: () => legacySurface,
            });
            try {
                component.switchToChannelByNumber(2);
                expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                    setActiveChannelDispatch(sampleChannel)
                );
            } finally {
                if (descriptor)
                    Object.defineProperty(
                        document,
                        'fullscreenElement',
                        descriptor
                    );
                else Reflect.deleteProperty(document, 'fullscreenElement');
            }
        });

        it.each(['menu', 'dialog', 'cdk-overlay-pane'])(
            'leaves paging keys to a short %s overlay',
            (kind) => {
                const overlay = document.createElement('div');
                if (kind === 'cdk-overlay-pane') {
                    overlay.className = kind;
                } else {
                    overlay.setAttribute('role', kind);
                }
                overlay.style.overflowY = 'auto';
                Object.defineProperty(overlay, 'scrollHeight', { value: 100 });
                Object.defineProperty(overlay, 'clientHeight', { value: 100 });
                const button = document.createElement('button');
                overlay.appendChild(button);
                document.body.appendChild(overlay);
                try {
                    for (const key of ['PageUp', 'PageDown']) {
                        const event = new KeyboardEvent('keydown', {
                            key,
                            bubbles: true,
                            cancelable: true,
                        });
                        button.dispatchEvent(event);
                        expect(event.defaultPrevented).toBe(false);
                    }
                    expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                        setActiveChannelDispatch(nextChannel)
                    );
                } finally {
                    overlay.remove();
                }
            }
        );

        it('honors a paging key already handled by another listener', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'PageDown',
                cancelable: true,
            });
            event.preventDefault();
            document.dispatchEvent(event);
            expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                setActiveChannelDispatch(nextChannel)
            );
        });

        it('PageDown plays the next channel and PageUp the previous one', () => {
            const pageDown = new KeyboardEvent('keydown', {
                key: 'PageDown',
                cancelable: true,
            });
            document.dispatchEvent(pageDown);

            expect(pageDown.defaultPrevented).toBe(true);
            expect(storeMock.dispatch).toHaveBeenCalledWith(
                setActiveChannelDispatch(nextChannel)
            );

            storeMock.dispatch.mockClear();
            setActive(nextChannel);
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'PageUp' })
            );

            expect(storeMock.dispatch).toHaveBeenCalledWith(
                setActiveChannelDispatch(sampleChannel)
            );
        });

        it('leaves the key to a focused row inside a scrollable list', () => {
            const list = document.createElement('div');
            list.style.overflowY = 'auto';
            Object.defineProperty(list, 'scrollHeight', { value: 500 });
            Object.defineProperty(list, 'clientHeight', { value: 100 });
            const row = document.createElement('button');
            list.appendChild(row);
            fixture.nativeElement.appendChild(list);

            const event = new KeyboardEvent('keydown', {
                key: 'PageDown',
                bubbles: true,
                cancelable: true,
            });
            row.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(false);
            expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                setActiveChannelDispatch(nextChannel)
            );
        });

        it('ignores PageUp/PageDown with a modifier held', () => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true })
            );

            expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                setActiveChannelDispatch(nextChannel)
            );
        });

        it('ignores the keys until a channel is playing, without queueing them', () => {
            // handleRemoteChannelChange waits for an active channel, so a press
            // taken before the first selection would sit on a pending
            // subscription and zap straight off that channel once it arrives.
            activeChannel.set(null);
            activeChannel$.next(null);
            fixture.detectChanges();

            const event = new KeyboardEvent('keydown', {
                key: 'PageDown',
                cancelable: true,
            });
            document.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(false);
            expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                setActiveChannelDispatch(nextChannel)
            );

            // The queued press must not fire when the user picks a channel.
            setActive(sampleChannel);
            fixture.detectChanges();
            expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                setActiveChannelDispatch(nextChannel)
            );
        });
    });
});
