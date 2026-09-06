import { AsyncPipe } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { EMPTY, of } from 'rxjs';
import { ChannelActions, EpgActions } from '@iptvnator/m3u-state';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    LIVE_EPG_PANEL_STATE_STORAGE_KEY,
    WorkspaceHeaderContextService,
} from '@iptvnator/portal/shared/util';
import {
    DataService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    Channel,
    EpgProgram,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
    Settings,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import type { VideoPlayerComponent as VideoPlayerComponentInstance } from './video-player.component';
import {
    activeChannel,
    activeEpgProgram,
    buildAiringProgram,
    activePlaybackUrl,
    channels,
    channels$,
    activeChannel$,
    channelsLoading,
    currentEpgProgram,
    currentEpgProgram$,
    dataServiceMock,
    epgPrograms$,
    epgServiceMock,
    epgUrlSetting,
    epgViewMode,
    externalSession,
    player,
    playlistId,
    playlistsServiceMock,
    routerMock,
    sampleChannel,
    showCaptions,
    storeMock,
    stripCountryPrefix,
    syncStoreState,
} from './video-player.spec-harness';
import {
    StubAudioPlayerComponent,
    StubChannelListLoadingStateComponent,
    StubEpgGuideComponent,
    StubEpgGuideNowPlayingComponent,
    StubEpgTimelineComponent,
    StubPortalEmptyStateComponent,
    StubResizableDirective,
    StubSidebarComponent,
    StubWebPlayerViewComponent,
} from './video-player.spec-stubs';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

describe('VideoPlayerComponent', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;
    let component: VideoPlayerComponentInstance;
    let headerContext: WorkspaceHeaderContextService;

    const originalElectron = window.electron;

    beforeAll(async () => {
        ({ VideoPlayerComponent } = await import('./video-player.component'));
    });

    beforeEach(async () => {
        window.electron = {
            platform: 'darwin',
            updateRemoteControlStatus: jest.fn(),
            onChannelChange: jest.fn(() => jest.fn()),
            onRemoteControlCommand: jest.fn(() => jest.fn()),
            getEpgProgramsForChannels: jest.fn().mockResolvedValue({}),
            getEpgProgramCoverage: jest.fn().mockResolvedValue([]),
        } as unknown as typeof window.electron;

        syncStoreState(null);
        playlistId.set('playlist-1');
        localStorage.removeItem('m3u-sidebar-width');
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        player.set(VideoPlayer.VideoJs);
        showCaptions.set(false);
        stripCountryPrefix.set(false);
        activePlaybackUrl.set(null);
        channelsLoading.set(false);
        currentEpgProgram.set(null);
        activeEpgProgram.set(null);
        externalSession.set(null);
        currentEpgProgram$.next(null);
        epgPrograms$.next([]);
        routerMock.currentNavigation.mockReturnValue(null);
        routerMock.navigate.mockClear();
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
                    // The guide source service reads labels through
                    // `instant` and re-computes them on `onLangChange`.
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        onLangChange: EMPTY,
                    },
                },
                {
                    provide: DataService,
                    useValue: dataServiceMock,
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                        get isElectron() {
                            return Boolean(window.electron);
                        },
                        // Mirrors the real capability check: every
                        // remote-control bridge method must be present.
                        get supportsRemoteControl() {
                            const bridge = window.electron as
                                Record<string, unknown> | undefined;
                            return [
                                'updateRemoteControlStatus',
                                'onChannelChange',
                                'onRemoteControlCommand',
                            ].every(
                                (method) =>
                                    typeof bridge?.[method] === 'function'
                            );
                        },
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsServiceMock,
                },
                {
                    provide: EpgService,
                    useValue: epgServiceMock,
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
                        stripCountryPrefix,
                        resolvedEpgViewMode: epgViewMode,
                        resolvedEpgOffsetMinutes: signal(0),
                        epgUrl: epgUrlSetting,
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
                        activeSession: externalSession,
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
                        StubEpgGuideComponent,
                        StubEpgGuideNowPlayingComponent,
                        StubEpgTimelineComponent,
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
        window.electron = originalElectron;
    });

    it('registers and clears the workspace guide header shortcut', () => {
        fixture.detectChanges();

        expect(headerContext.action()).toEqual(
            expect.objectContaining({
                id: 'm3u-epg-guide',
                icon: 'grid_view',
            })
        );

        fixture.destroy();
        expect(headerContext.action()).toBeNull();
    });

    it('opens the guide in place of sidebar and timeline without remounting the player', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        const playerBefore = fixture.nativeElement.querySelector(
            'app-web-player-view'
        );
        expect(playerBefore).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.sidebar')).not.toBeNull();

        component.openGuide();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-epg-guide')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-guide-now-playing')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.sidebar')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.content-container').classList
        ).toContain('is-guide');
        expect(fixture.nativeElement.querySelector('app-web-player-view')).toBe(
            playerBefore
        );
        expect(headerContext.action()?.active?.()).toBe(true);

        component.closeGuide();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('app-epg-guide')).toBeNull();
        // The sidebar list itself sits behind an `@defer`, so the assertion
        // targets the container the guide mode actually removes.
        expect(fixture.nativeElement.querySelector('.sidebar')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-web-player-view')).toBe(
            playerBefore
        );
    });

    it('toggles the guide with G, ignores typing, and lets the guide own other keys', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'g', bubbles: true })
        );
        fixture.detectChanges();
        expect(component.guideOpen()).toBe(true);

        storeMock.dispatch.mockClear();
        const pageDown = new KeyboardEvent('keydown', {
            key: 'PageDown',
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(pageDown);
        expect(pageDown.defaultPrevented).toBe(false);
        expect(storeMock.dispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({
                type: expect.stringContaining('setActiveChannel'),
            })
        );

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'G', bubbles: true })
        );
        expect(component.guideOpen()).toBe(false);

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'g', bubbles: true })
        );
        expect(component.guideOpen()).toBe(false);
        input.remove();
    });

    it('closes the guide when the live player enters fullscreen or the channel turns to radio', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        component.openGuide();
        fixture.detectChanges();

        const playerView = fixture.nativeElement.querySelector(
            'app-web-player-view'
        ) as HTMLElement;
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => playerView,
        });
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(component.guideOpen()).toBe(false);
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => null,
        });

        component.openGuide();
        expect(component.guideOpen()).toBe(true);
        syncStoreState({ ...sampleChannel, radio: 'true' } as Channel);
        fixture.detectChanges();
        expect(component.guideOpen()).toBe(false);
    });

    it('remembers the collapsed dock strip', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        component.openGuide();
        component.setGuideDockCollapsed(true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.content-container').classList
        ).toContain('is-guide-collapsed');
        expect(localStorage.getItem('epg-guide:dock-collapsed')).toBe('1');
        localStorage.removeItem('epg-guide:dock-collapsed');
    });

    it('suspends the docked player shortcuts while the guide is open', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        const dock = fixture.nativeElement.querySelector(
            '.video-player'
        ) as HTMLElement;
        expect(dock.hasAttribute('data-player-shortcuts-suspended')).toBe(
            false
        );

        component.openGuide();
        fixture.detectChanges();
        expect(dock.hasAttribute('data-player-shortcuts-suspended')).toBe(true);

        component.closeGuide();
        fixture.detectChanges();
        expect(dock.hasAttribute('data-player-shortcuts-suspended')).toBe(
            false
        );
    });

    it('derives the docked strip programme from the active channel schedule', () => {
        // The NgRx `currentEpgProgram` retains the previous channel's value
        // across a switch, so the strip must not read it.
        currentEpgProgram.set(buildAiringProgram('Retained Show'));
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        epgPrograms$.next([buildAiringProgram('Sample Now')]);
        fixture.detectChanges();
        component.openGuide();
        fixture.detectChanges();
        const stripProgram = () =>
            fixture.debugElement
                .query(By.directive(StubEpgGuideNowPlayingComponent))
                .componentInstance.program();

        expect(stripProgram()).toEqual(
            expect.objectContaining({ title: 'Sample Now' })
        );

        syncStoreState({
            ...sampleChannel,
            id: 'channel-2',
            url: 'http://localhost/other.m3u8',
            name: 'Other TV',
            tvg: { id: 'other-tvg-id', name: 'Other TV', logo: '' },
        } as Channel);
        epgPrograms$.next([buildAiringProgram('Other Now', 'other-tvg-id')]);
        fixture.detectChanges();

        expect(stripProgram()).toEqual(
            expect.objectContaining({ title: 'Other Now' })
        );

        epgPrograms$.next([]);
        fixture.detectChanges();

        expect(stripProgram()).toBeNull();
    });

    it('disables the guide header action while nothing can host the guide', () => {
        syncStoreState(null);
        fixture.detectChanges();

        expect(headerContext.action()?.disabled?.()).toBe(true);

        syncStoreState(sampleChannel);
        fixture.detectChanges();

        expect(headerContext.action()?.disabled?.()).toBe(false);
    });

    it('closes the guide when the active playlist changes', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        component.openGuide();
        fixture.detectChanges();
        expect(component.guideOpen()).toBe(true);

        playlistId.set('playlist-2');
        fixture.detectChanges();

        expect(component.guideOpen()).toBe(false);
    });

    it('strips country prefixes from the timeline and player titles when enabled', () => {
        stripCountryPrefix.set(true);
        syncStoreState({ ...sampleChannel, name: 'US | CNN' } as Channel);

        fixture.detectChanges();

        expect(component.timelineChannelName()).toBe('CNN');
        expect(component.displayChannelName()).toBe('CNN');
        expect(component.inlinePlayerTitle()).toBe('CNN');
    });

    it('keeps raw channel names while prefix stripping is disabled', () => {
        syncStoreState({ ...sampleChannel, name: 'US | CNN' } as Channel);

        fixture.detectChanges();

        expect(component.timelineChannelName()).toBe('US | CNN');
        expect(component.displayChannelName()).toBe('US | CNN');
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
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).not.toBeNull();
    });

    it('swaps the timeline for the list view when epgViewMode is "list"', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        epgViewMode.set('list');

        fixture.detectChanges();

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

        epgViewMode.set('timeline'); // restore for sibling tests
    });

    it('hides EPG controls and the guide header action in browser/PWA playback', () => {
        fixture.destroy();
        window.electron = undefined as unknown as typeof window.electron;

        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        headerContext = TestBed.inject(WorkspaceHeaderContextService);
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-web-player-view')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.epg')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).toBeNull();
        expect(headerContext.action()).toBeNull();
    });

    it('does not publish remote-control status when the bridge is incomplete', () => {
        fixture.destroy();
        const updateRemoteControlStatus = jest.fn();
        window.electron = {
            updateRemoteControlStatus,
        } as typeof window.electron;

        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        syncStoreState(sampleChannel);
        fixture.detectChanges();

        expect(updateRemoteControlStatus).not.toHaveBeenCalled();
    });

    it('reports no remote volume support and ignores volume commands on external players', () => {
        const updateRemoteControlStatus = window.electron
            ?.updateRemoteControlStatus as jest.Mock;
        player.set(VideoPlayer.MPV);
        fixture.detectChanges();
        syncStoreState(sampleChannel);

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                portal: 'm3u',
                isLiveView: true,
                supportsVolume: false,
            })
        );

        localStorage.removeItem('volume');
        (
            component as unknown as {
                handleRemoteControlCommand(command: {
                    type: 'volume-down';
                }): void;
            }
        ).handleRemoteControlCommand({ type: 'volume-down' });

        // The command must not touch the stored web-player volume either.
        expect(localStorage.getItem('volume')).toBeNull();
    });

    it('reports remote volume support for built-in inline playback', () => {
        const updateRemoteControlStatus = window.electron
            ?.updateRemoteControlStatus as jest.Mock;
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        syncStoreState(sampleChannel);

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                supportsVolume: true,
                volume: 1,
                muted: false,
            })
        );
    });

    it('publishes a remote status reset when the player view is destroyed', () => {
        const updateRemoteControlStatus = window.electron
            ?.updateRemoteControlStatus as jest.Mock;
        fixture.detectChanges();
        syncStoreState(sampleChannel);
        updateRemoteControlStatus.mockClear();

        fixture.destroy();

        expect(updateRemoteControlStatus).toHaveBeenCalledWith({
            portal: 'unknown',
            isLiveView: false,
            supportsVolume: false,
        });
    });

    it('publishes a remote status reset when the active channel clears in place', () => {
        const updateRemoteControlStatus = window.electron
            ?.updateRemoteControlStatus as jest.Mock;
        fixture.detectChanges();
        syncStoreState(sampleChannel);
        updateRemoteControlStatus.mockClear();

        // E.g. quitting an external player dispatches resetActiveChannel
        // while the route stays mounted.
        syncStoreState(null);

        expect(updateRemoteControlStatus).toHaveBeenCalledWith({
            portal: 'unknown',
            isLiveView: false,
            supportsVolume: false,
        });
    });

    it('drops remote volume support while a live external session owns the audio', () => {
        const updateRemoteControlStatus = window.electron
            ?.updateRemoteControlStatus as jest.Mock;
        player.set(VideoPlayer.Html5Player);
        fixture.detectChanges();
        syncStoreState(sampleChannel);
        updateRemoteControlStatus.mockClear();

        // Diagnostic-recovery launch: web player configured, MPV audible.
        externalSession.set({
            id: 'external-1',
            player: 'mpv',
            status: 'playing',
            title: sampleChannel.name,
            streamUrl: sampleChannel.url,
            startedAt: '2026-08-08T00:00:00.000Z',
            updatedAt: '2026-08-08T00:00:00.000Z',
        });
        fixture.detectChanges();

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isLiveView: true,
                supportsVolume: false,
            })
        );

        // The DASH-forced inline player is not audible either while the
        // managed clear-DASH fallback session is live.
        syncStoreState({
            ...sampleChannel,
            url: 'http://localhost/live.mpd',
        } as Channel);
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({ supportsVolume: false })
        );

        externalSession.set(null);
        fixture.detectChanges();

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({ supportsVolume: true })
        );
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

        const playback: ResolvedPortalPlayback = {
            streamUrl: 'https://archive.example.com/live.m3u8?utc=1',
            title: 'Sample TV',
            isLive: true,
            headers: {
                'user-agent': 'IPTVnator Test',
                Referer: 'https://referrer.example.com',
                Origin: 'https://origin.example.com',
            },
        };
        const launch = Promise.resolve();
        const trackLaunch = jest.fn();
        dataServiceMock.sendIpcEvent.mockReturnValueOnce(launch);
        component.handleExternalFallbackRequest({
            player: 'mpv',
            playback,
            trackLaunch,
            diagnostic: {
                code: 'unsupported-codec',
                source: 'hls',
                sourceUrl: 'https://archive.example.com/live.m3u8?utc=1',
                container: 'm3u8',
                audioCodecs: ['ac-3'],
                videoCodecs: ['avc1.64001f'],
            },
        } satisfies PlaybackFallbackRequest);

        expect(dataServiceMock.sendIpcEvent).toHaveBeenCalledWith(
            'OPEN_MPV_PLAYER',
            {
                url: 'https://archive.example.com/live.m3u8?utc=1',
                title: 'Sample TV',
                'user-agent': 'IPTVnator Test',
                referer: 'https://referrer.example.com',
                origin: 'https://origin.example.com',
            }
        );
        expect(trackLaunch).toHaveBeenCalledWith(launch);
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
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).not.toBeNull();
    });

    it('renders only the EPG panel when an external player is configured', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.MPV);

        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.video-player')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).not.toBeNull();
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                ?.classList.contains('epg-collapsed')
        ).toBe(false);
    });

    it('clears the channel when a closable error becomes terminal', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.MPV);
        const closableError: ExternalPlayerSession = {
            id: 'external-1',
            player: 'mpv',
            status: 'error',
            title: sampleChannel.name,
            streamUrl: sampleChannel.url,
            startedAt: '2026-08-08T00:00:00.000Z',
            updatedAt: '2026-08-08T00:00:00.000Z',
            error: 'Process exit was not confirmed',
            canClose: true,
        };
        externalSession.set(closableError);
        fixture.detectChanges();
        expect(storeMock.dispatch).not.toHaveBeenCalledWith(
            ChannelActions.resetActiveChannel()
        );

        externalSession.set({
            ...closableError,
            canClose: false,
            updatedAt: '2026-08-08T00:00:01.000Z',
        });
        fixture.detectChanges();

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.resetActiveChannel()
        );
    });

    it('keeps DASH channels inline on the HTML5 player even when MPV is configured', () => {
        syncStoreState({
            ...sampleChannel,
            url: 'http://localhost/live.mpd',
        } as Channel);
        player.set(VideoPlayer.MPV);

        fixture.detectChanges();

        const playerView = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        );
        expect(playerView).not.toBeNull();
        const stub = playerView.componentInstance as StubWebPlayerViewComponent;
        expect(stub.playerOverride()).toBe(VideoPlayer.Html5Player);
        expect(dataServiceMock.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('owns a collision-safe live session key that ignores resolved URL changes', () => {
        playlistId.set('playlist|one');
        syncStoreState({ ...sampleChannel, id: 'channel|one' } as Channel);
        activePlaybackUrl.set('https://archive.example/first.m3u8');
        fixture.detectChanges();

        const playerView = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        const expected = createPlaybackSessionKey({
            kind: 'live',
            sourceId: 'playlist|one',
            contentId: 'channel|one',
        });
        expect(playerView.playbackSessionKey()).toBe(expected);

        activePlaybackUrl.set('https://archive.example/second.m3u8');
        fixture.detectChanges();
        expect(playerView.playbackSessionKey()).toBe(expected);

        syncStoreState({ ...sampleChannel, id: 'channel|two' } as Channel);
        fixture.detectChanges();
        expect(playerView.playbackSessionKey()).not.toBe(expected);
    });

    it('routes catch-up playback that resolves to a DASH URL inline as well', () => {
        syncStoreState(sampleChannel);
        activePlaybackUrl.set('http://localhost/archive/replay.mpd');
        player.set(VideoPlayer.MPV);

        fixture.detectChanges();

        const playerView = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        );
        expect(playerView).not.toBeNull();
        const stub = playerView.componentInstance as StubWebPlayerViewComponent;
        expect(stub.playerOverride()).toBe(VideoPlayer.Html5Player);
    });

    it('keeps a DASH channel inline when its catch-up resolves to a non-DASH URL', () => {
        syncStoreState({
            ...sampleChannel,
            url: 'http://localhost/live.mpd',
        } as Channel);
        activePlaybackUrl.set('http://localhost/archive/replay.m3u8');
        player.set(VideoPlayer.MPV);

        fixture.detectChanges();

        // The external-player guard declines DASH channels, so the inline
        // player must stay — otherwise the session has no player at all.
        expect(
            fixture.debugElement.query(By.directive(StubWebPlayerViewComponent))
        ).not.toBeNull();
    });

    it('extracts DRM lazily from raw KODIPROP for pre-upgrade playlists', () => {
        const kid = '00112233445566778899aabbccddeeff';
        const key = 'ffeeddccbbaa99887766554433221100';
        syncStoreState({
            ...sampleChannel,
            url: 'http://localhost/enc.mpd',
            raw: [
                '#EXTINF:-1,Encrypted',
                '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                `#KODIPROP:inputstream.adaptive.license_key=${kid}:${key}`,
                'http://localhost/enc.mpd',
            ].join('\r\n'),
        } as Channel);
        player.set(VideoPlayer.Html5Player);

        fixture.detectChanges();

        const stub = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        expect(stub.playback()).toEqual(
            expect.objectContaining({
                drm: {
                    licenseType: 'clearkey',
                    supported: true,
                    clearKeys: { [kid]: key },
                },
            })
        );
    });

    it('keeps ArtPlayer for DASH channels and forwards the ClearKey DRM config', () => {
        const drm = {
            licenseType: 'clearkey',
            supported: true,
            clearKeys: { '11223344556677889900aabbccddeeff': 'f'.repeat(32) },
        };
        syncStoreState({
            ...sampleChannel,
            url: 'http://localhost/live.mpd',
            drm,
        } as Channel);
        player.set(VideoPlayer.ArtPlayer);

        fixture.detectChanges();

        const stub = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        expect(stub.playerOverride()).toBe(VideoPlayer.ArtPlayer);
        expect(stub.playback()).toEqual(expect.objectContaining({ drm }));
    });

    it('routes Video.js users to the HTML5 player only for DASH channels', () => {
        syncStoreState({
            ...sampleChannel,
            url: 'http://localhost/live.mpd',
        } as Channel);
        player.set(VideoPlayer.VideoJs);

        fixture.detectChanges();

        let stub = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        expect(stub.playerOverride()).toBe(VideoPlayer.Html5Player);

        syncStoreState(sampleChannel);
        fixture.detectChanges();

        stub = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        expect(stub.playerOverride()).toBe(VideoPlayer.VideoJs);
    });

    it('passes remote volume changes to the radio audio player', () => {
        const radioChannel = {
            ...sampleChannel,
            radio: 'true',
        } as Channel;
        syncStoreState(radioChannel);
        fixture.detectChanges();

        (
            component as unknown as {
                handleRemoteControlCommand(command: {
                    type: 'volume-down';
                }): void;
            }
        ).handleRemoteControlCommand({ type: 'volume-down' });
        fixture.detectChanges();

        const audioPlayer = fixture.debugElement.query(
            By.directive(StubAudioPlayerComponent)
        ).componentInstance as StubAudioPlayerComponent;
        expect(audioPlayer.volume()).toBe(0.9);
    });

    it('keeps parent volume state in sync with radio player controls', () => {
        const radioChannel = {
            ...sampleChannel,
            radio: 'true',
        } as Channel;
        syncStoreState(radioChannel);
        fixture.detectChanges();

        const audioPlayer = fixture.debugElement.query(
            By.directive(StubAudioPlayerComponent)
        ).componentInstance as StubAudioPlayerComponent;

        audioPlayer.volumeChange.emit(0.35);
        fixture.detectChanges();

        expect(audioPlayer.volume()).toBe(0.35);
        expect(localStorage.getItem('volume')).toBe('0.35');
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

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        );
        expect(timeline.componentInstance.collapsed()).toBe(true);
    });

    it('persists live EPG panel toggle changes from the timeline', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);

        fixture.detectChanges();

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        );

        timeline.componentInstance.collapsedChange.emit(true);
        fixture.detectChanges();

        expect(component.isLiveEpgPanelCollapsed()).toBe(true);
        expect(timeline.componentInstance.collapsed()).toBe(true);
        expect(localStorage.getItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY)).toBe(
            'collapsed'
        );

        timeline.componentInstance.collapsedChange.emit(false);
        fixture.detectChanges();

        expect(component.isLiveEpgPanelCollapsed()).toBe(false);
        expect(timeline.componentInstance.collapsed()).toBe(false);
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

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        );
        expect(timeline.componentInstance.summary()).toEqual(
            expect.objectContaining({ title: 'Current Show' })
        );
        expect(timeline.componentInstance.summaryLabelKey()).toBe(
            'EPG.CURRENT_PROGRAM'
        );
    });

    it('uses the active playback override url when archive playback is active', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        activePlaybackUrl.set('http://localhost/archive.m3u8?utc=123&lutc=456');

        fixture.detectChanges();

        expect(component.playbackChannel()?.url).toBe(
            'http://localhost/archive.m3u8?utc=123&lutc=456'
        );
        expect(component.embeddedPlayback()?.isLive).toBe(false);

        activePlaybackUrl.set(null);
        fixture.detectChanges();

        expect(component.playbackChannel()?.url).toBe(sampleChannel.url);
        expect(component.embeddedPlayback()?.isLive).toBe(true);
    });

    it('passes the active archive EPG program to the EPG list for highlighting', () => {
        const archivedProgram: EpgProgram = {
            channel: 'sample-tvg-id',
            start: '2026-06-28T09:00:00.000Z',
            stop: '2026-06-28T10:00:00.000Z',
            title: 'Archived Show',
            desc: null,
            category: null,
            startTimestamp: 1782637200,
            stopTimestamp: 1782640800,
        };
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        activePlaybackUrl.set('http://localhost/archive.m3u8?utc=123&lutc=456');
        activeEpgProgram.set(archivedProgram);

        fixture.detectChanges();

        const epgList = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        );

        expect(epgList.componentInstance.activeProgram()).toEqual(
            archivedProgram
        );
    });

    it('shows the active archive EPG program in the inline panel summary', () => {
        const archivedProgram = buildProgram('Archived Show');
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        activePlaybackUrl.set('http://localhost/archive.m3u8?utc=123&lutc=456');
        activeEpgProgram.set(archivedProgram);

        fixture.detectChanges();

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        );

        expect(timeline.componentInstance.summary()).toEqual(
            expect.objectContaining({ title: 'Archived Show' })
        );
        expect(timeline.componentInstance.summaryLabelKey()).toBe(
            'EPG.ARCHIVE_PLAYBACK'
        );
        expect(timeline.componentInstance.isLivePlayback()).toBe(false);
    });

    it('dispatches return-to-live from the inline EPG panel', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        activePlaybackUrl.set('http://localhost/archive.m3u8?utc=123&lutc=456');
        activeEpgProgram.set(buildProgram('Archived Show'));

        fixture.detectChanges();

        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        );
        timeline.componentInstance.returnToLive.emit();

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            EpgActions.returnToLivePlayback()
        );
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

    it('reuses the registered header shortcut callback to toggle the guide', () => {
        syncStoreState(sampleChannel);
        fixture.detectChanges();

        headerContext.action()?.run();
        expect(component.guideOpen()).toBe(true);

        headerContext.action()?.run();
        expect(component.guideOpen()).toBe(false);
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

    it('opens an M3U channel passed from global search route state', () => {
        const globalSearchChannel = {
            ...sampleChannel,
            id: 'global-search-channel',
            url: 'http://localhost/global-search-live.m3u8',
            name: 'Global Search Live',
        } as Channel;
        routerMock.currentNavigation.mockReturnValue({
            extras: {
                state: {
                    openM3uChannelUrl: globalSearchChannel.url,
                },
            },
        });
        activeChannel.set(null);
        activeChannel$.next(null);
        channels.set([sampleChannel, globalSearchChannel]);
        channels$.next([sampleChannel, globalSearchChannel]);

        fixture.detectChanges();

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({ channel: globalSearchChannel })
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

    it('does not reset active timeshift on the now-tick during an EPG gap', () => {
        // In catch-up (activePlaybackUrl set) with programmes that don't cover
        // "now", the 30s tick must NOT dispatch resetActiveEpgProgram — that
        // reducer nulls activePlaybackUrl and would silently drop the user back
        // to the live stream every 30 seconds.
        syncStoreState(sampleChannel);
        activePlaybackUrl.set('http://localhost/catchup.m3u8');
        fixture.detectChanges();
        storeMock.dispatch.mockClear();

        epgPrograms$.next([buildProgram('Earlier')]); // no programme airing now
        fixture.detectChanges();

        expect(storeMock.dispatch).not.toHaveBeenCalledWith(
            EpgActions.resetActiveEpgProgram()
        );
    });

    it('still clears stale EPG state on the now-tick when playing live', () => {
        syncStoreState(sampleChannel);
        activePlaybackUrl.set(null); // live, not timeshift
        fixture.detectChanges();
        storeMock.dispatch.mockClear();

        epgPrograms$.next([buildProgram('Earlier')]);
        fixture.detectChanges();

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            EpgActions.resetActiveEpgProgram()
        );
    });

    describe('EPG needs-setup empty state', () => {
        beforeEach(() => {
            // Earlier tests leave programmes in the shared subject; the
            // component keeps a live subscription, so this reset reaches it.
            epgUrlSetting.set([]);
            epgPrograms$.next([]);
        });

        afterEach(() => {
            epgUrlSetting.set([]);
            epgPrograms$.next([]);
        });

        it('claims needs-setup only while no EPG source exists anywhere', () => {
            expect(component.liveEpgEmptyReason()).toBe('m3u-needs-setup');

            epgUrlSetting.set(['https://example.org/guide.xml']);

            expect(component.liveEpgEmptyReason()).toBe('none');
        });

        it('never overrides a channel that actually has programmes', () => {
            // Uploaded XMLTV files produce programmes without any
            // configured source URL — the ribbon must win over the hint.
            epgPrograms$.next([buildProgram('Morning Bulletin')]);

            expect(component.liveEpgEmptyReason()).toBe('none');
        });

        it('deep links the empty-state button to the EPG settings page', () => {
            component.openEpgSettings();

            expect(routerMock.navigate).toHaveBeenCalledWith([
                '/workspace/settings',
                'epg',
            ]);
        });
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
