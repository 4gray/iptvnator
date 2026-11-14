import { AsyncPipe } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { of } from 'rxjs';
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
import {
    MultiviewEntryService,
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
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
    translateServiceProvider,
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
import {
    MultiviewPlayerDirective,
    MultiviewAnchorPlaceholderComponent,
} from '@iptvnator/ui/playback/multiview-anchor';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

/**
 * The M3U player as a multiview anchor (spec 11.2.4). The stub imports of
 * the other specs leave the anchor's placeholder out; here it is added, as
 * in the real component.
 */
describe('VideoPlayerComponent multiview anchor', () => {
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
                translateServiceProvider,
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
                            const bridge:
                                Partial<typeof window.electron> | undefined =
                                window.electron;
                            return (
                                [
                                    'updateRemoteControlStatus',
                                    'onChannelChange',
                                    'onRemoteControlCommand',
                                ] as const
                            ).every(
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
                        MultiviewPlayerDirective,
                        MultiviewAnchorPlaceholderComponent,
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

    const OTHER: MultiviewTileSource = {
        playback: {
            streamUrl: 'http://localhost/other.m3u8',
            title: 'Other TV',
            isLive: true,
        },
        playbackSessionKey: 'live|playlist-1|channel-2',
        kind: 'live',
        playlistId: 'playlist-1',
        contentId: 'channel-2',
        title: 'Other TV',
    };
    const otherChannel = {
        ...sampleChannel,
        id: 'channel-2',
        url: 'http://localhost/other.m3u8',
        name: 'Other TV',
    } as Channel;

    const inlinePlayer = (): HTMLElement | null =>
        fixture.nativeElement.querySelector('app-web-player-view');
    const placeholder = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="multiview-anchor-placeholder"]'
        );

    function startSession(): void {
        syncStoreState(sampleChannel);
        channels.set([sampleChannel, otherChannel]);
        fixture.detectChanges();
        TestBed.inject(MultiviewEntryService).add(OTHER);
        fixture.detectChanges();
    }

    it('renders the inline player as before while no session exists', () => {
        syncStoreState(sampleChannel);
        fixture.detectChanges();

        expect(inlinePlayer()).not.toBeNull();
        expect(placeholder()).toBeNull();
        expect(component.multiviewAnchor.host.source()).toMatchObject({
            playbackSessionKey: createPlaybackSessionKey({
                kind: 'live',
                sourceId: 'playlist-1',
                contentId: 'channel-1',
            }),
            contentId: 'channel-1',
            kind: 'live',
        });
    });

    it('hands the playing channel to tile 1 when a session starts here', () => {
        startSession();
        const store = TestBed.inject(MultiviewSessionStore);

        expect(store.anchorId()).toBe('m3u-player');
        expect(store.tiles()[0]).toMatchObject({
            contentId: 'channel-1',
            engine: VideoPlayer.VideoJs,
        });
        expect(inlinePlayer()).toBeNull();
        expect(placeholder()).not.toBeNull();
    });

    it('selects the surviving channel when the session ends', () => {
        startSession();
        const store = TestBed.inject(MultiviewSessionStore);
        storeMock.dispatch.mockClear();

        store.setAudio(store.tiles()[1].id);
        store.exit();
        fixture.detectChanges();

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({ channel: otherChannel })
        );
    });

    it('ends the session when the player is left', () => {
        startSession();

        fixture.destroy();

        expect(TestBed.inject(MultiviewSessionStore).exists()).toBe(false);
    });
});
