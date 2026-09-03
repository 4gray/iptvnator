import { Component, input, output } from '@angular/core';
import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { VodSourceRowComponent } from '@iptvnator/ui/components';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    VideoPlayer,
    type RecordingStartMetadata,
    type RecordingStoppedEvent,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { ErrorDetails, ErrorTypes } from 'hls.js';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';
import {
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '@iptvnator/playback/util';
import { PlaybackDiagnosticPanelComponent } from '../playback-diagnostic-panel/playback-diagnostic-panel.component';
import {
    getDiagnosticCodecHint,
    getDiagnosticDescriptionKey as resolveDiagnosticDescriptionKey,
    getDiagnosticDetails,
    getDiagnosticMeta,
    getDiagnosticTitleKey,
} from '../playback-diagnostic-panel/playback-diagnostic-view.util';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({
    selector: 'app-vjs-player',
    template: '<div data-test-id="stub-vjs-player"></div>',
})
class StubVjsPlayerComponent {
    readonly options = input<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

@Component({
    selector: 'app-html-video-player',
    template: '<div data-test-id="stub-html-player"></div>',
})
class StubHtmlVideoPlayerComponent {
    readonly channel = input<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

@Component({
    selector: 'app-art-player',
    template: '<div data-test-id="stub-art-player"></div>',
})
class StubArtPlayerComponent {
    readonly channel = input<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

@Component({
    selector: 'app-embedded-mpv-player',
    template: '<div data-test-id="stub-embedded-mpv-player"></div>',
})
class StubEmbeddedMpvPlayerComponent {
    readonly playback = input.required<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly recordingFolder = input('');
    readonly recordingMetadata = input<RecordingStartMetadata | null>(null);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly recordingStopped = output<RecordingStoppedEvent>();
}

describe('WebPlayerViewComponent', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let component: WebPlayerViewComponentInstance;
    const storageMap = {
        get: jest.fn(() => of({ player: VideoPlayer.VideoJs })),
        set: jest.fn(() => of(undefined)),
    };
    let runtimeCapabilities: { supportsManagedExternalPlayers: boolean };

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    beforeEach(async () => {
        runtimeCapabilities = { supportsManagedExternalPlayers: false };

        await TestBed.configureTestingModule({
            // @defer blocks render their main content synchronously in tests.
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                { provide: StorageMap, useValue: storageMap },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
            ],
        })
            .overrideComponent(WebPlayerViewComponent, {
                set: {
                    imports: [
                        StubArtPlayerComponent,
                        StubEmbeddedMpvPlayerComponent,
                        StubHtmlVideoPlayerComponent,
                        StubVjsPlayerComponent,
                        PlaybackDiagnosticPanelComponent,
                        // Real, not stubbed: the point of the test below is
                        // that this row's Check action reaches the host.
                        VodSourceRowComponent,
                        ClipboardModule,
                        MatButtonModule,
                        MatIconModule,
                        MatTooltipModule,
                        TranslateModule,
                    ],
                },
            })
            .compileComponents();

        storageMap.get.mockReturnValue(of({ player: VideoPlayer.VideoJs }));
        fixture = TestBed.createComponent(WebPlayerViewComponent);
        fixture.componentRef.setInput('playbackSessionKey', 'test-session');
        component = fixture.componentInstance;
        fixture.componentRef.setInput(
            'streamUrl',
            'https://example.com/archive/movie.mkv'
        );
        fixture.componentRef.setInput('title', 'Example Movie');
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('anchors overlay UI to the player view host', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.classList).toContain('web-player-view');
    });

    describe('resolvedMediaTitle', () => {
        it('prefers an explicit media title over the playback title', async () => {
            fixture.componentRef.setInput('mediaTitle', {
                primary: 'Breaking Code',
                secondary: 'S01E02',
            });
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(component.resolvedMediaTitle()).toEqual({
                primary: 'Breaking Code',
                secondary: 'S01E02',
            });

            const player = fixture.debugElement.query(
                By.directive(StubVjsPlayerComponent)
            ).componentInstance as StubVjsPlayerComponent;
            expect(player.mediaTitle()).toEqual({
                primary: 'Breaking Code',
                secondary: 'S01E02',
            });
        });

        it('falls back to the playback title as a single line', () => {
            fixture.detectChanges();

            expect(component.resolvedMediaTitle()).toEqual({
                primary: 'Example Movie',
                secondary: null,
            });
        });

        it('is null when the title falls back to the raw stream URL', () => {
            fixture.componentRef.setInput('title', '');
            fixture.detectChanges();

            expect(component.resolvedMediaTitle()).toBeNull();
        });
    });

    it('relays the alternative row’s Check action out of the error screen', () => {
        const checked: string[] = [];
        component.sourceCheckRequested.subscribe((id) => checked.push(id));
        fixture.componentRef.setInput('alternativeSources', [
            {
                id: 'playlist-2:xtream:991',
                playlistId: 'playlist-2',
                playlistName: 'Portal Two',
                portalType: 'xtream',
                contentId: 991,
                rawTitle: 'Example Movie',
                matchConfidence: 'exact',
                year: null,
                isActive: false,
                isPinned: false,
                isTried: false,
                probe: { status: 'idle' },
            },
        ]);

        fixture.detectChanges();
        emitPlaybackIssue(createUnsupportedContainerDiagnostic());
        fixture.detectChanges();

        const check = fixture.debugElement.query(
            By.css('app-vod-source-row .source-tag--action')
        );
        expect(check).not.toBeNull();
        check.nativeElement.click();

        // Without the relay the button is visibly actionable and inert: the
        // row emits into an output nobody observes, so no probe ever runs.
        expect(checked).toEqual(['playlist-2:xtream:991']);
    });

    it('renders diagnostics and emits MPV fallback requests when managed external players are available', () => {
        const requests: unknown[] = [];
        runtimeCapabilities.supportsManagedExternalPlayers = true;
        component.externalFallbackRequested.subscribe((request) =>
            requests.push(request)
        );

        fixture.detectChanges();
        emitPlaybackIssue(createUnsupportedContainerDiagnostic());
        fixture.detectChanges();

        const banner = fixture.debugElement.query(
            By.css('[data-test-id="playback-diagnostic-banner"]')
        );
        const mpvButton = fixture.debugElement.query(
            By.css('[data-test-id="playback-fallback-mpv"]')
        );

        expect(banner.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CONTAINER.TITLE'
        );
        expect(banner.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.NATIVE_FALLBACK_TITLE'
        );
        mpvButton.nativeElement.click();

        expect(requests).toEqual([
            expect.objectContaining({
                player: 'mpv',
                playback: expect.objectContaining({
                    streamUrl: 'https://example.com/archive/movie.mkv',
                    title: 'Example Movie',
                }),
                diagnostic: expect.objectContaining({
                    code: PlaybackDiagnosticCode.UnsupportedContainer,
                }),
            }),
        ]);
    });

    it('renders explicit HTTP evidence without recommending an external fallback', () => {
        runtimeCapabilities.supportsManagedExternalPlayers = true;
        const issue = createHttpDiagnostic();

        fixture.detectChanges();
        emitPlaybackIssue(issue);
        fixture.detectChanges();

        const banner = fixture.debugElement.query(
            By.css('[data-test-id="playback-diagnostic-banner"]')
        );
        const mpvButton = fixture.debugElement.query(
            By.css('[data-test-id="playback-fallback-mpv"]')
        );

        expect(banner.nativeElement.textContent).toContain('HTTP 404');
        expect(mpvButton).toBeNull();
        expect(getDiagnosticMeta(issue)).toBe('HTTP 404');
        expect(getDiagnosticDetails(issue)).toEqual(
            expect.arrayContaining([
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
                    value: 'HTTP 404 · networkrequestfailed',
                },
            ])
        );
    });

    it.each([
        ['browser-access', createBrowserAccessDiagnostic],
        ['unsupported-codec', createUnsupportedCodecDiagnostic],
    ])(
        'uses neutral %s guidance when ClearKey playback cannot be transferred',
        (_diagnostic, createDiagnostic) => {
            runtimeCapabilities.supportsManagedExternalPlayers = true;
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://provider.example/protected.mpd',
                title: 'Protected stream',
                drm: {
                    licenseType: 'clearkey',
                    supported: true,
                    clearKeys: {
                        '00112233445566778899aabbccddeeff':
                            'ffeeddccbbaa99887766554433221100',
                    },
                },
            });

            fixture.detectChanges();
            emitPlaybackIssue(createDiagnostic());
            fixture.detectChanges();

            const banner = fixture.debugElement.query(
                By.css('[data-test-id="playback-diagnostic-banner"]')
            );

            expect(banner.nativeElement.textContent).toContain(
                'PLAYBACK_DIAGNOSTICS.UNTRANSFERABLE_FAILURE_TITLE'
            );
            expect(banner.nativeElement.textContent).toContain(
                'PLAYBACK_DIAGNOSTICS.UNTRANSFERABLE_DESCRIPTION'
            );
            expect(
                banner.query(
                    By.css(
                        '[data-test-id="playback-fallback-mpv"], [data-test-id="playback-fallback-vlc"]'
                    )
                )
            ).toBeNull();
        }
    );

    it('renders only sanitized structured HLS evidence in technical details', () => {
        const issue = createStructuredHlsDiagnostic();

        emitPlaybackIssue(issue);
        fixture.detectChanges();

        const details = getDiagnosticDetails(issue);
        const renderedDetails = details.map(({ value }) => value).join(' ');

        expect(details).toEqual(
            expect.arrayContaining([
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
                    value:
                        'stage=manifest · failure=http · ' +
                        'type=networkError · details=manifestLoadError · ' +
                        'disposition=fatal · HTTP 404',
                },
            ])
        );
        expect(renderedDetails).not.toContain('diagnostic-url-secret');
        expect(renderedDetails).not.toContain('provider.example');
    });

    it('renders only sanitized structured VHS evidence in technical details', () => {
        const issue = createStructuredVhsDiagnostic();

        emitPlaybackIssue(issue);
        fixture.detectChanges();

        const details = getDiagnosticDetails(issue);
        const renderedDetails = details.map(({ value }) => value).join(' ');

        expect(details).toEqual(
            expect.arrayContaining([
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_SOURCE',
                    value: 'Video.js / VHS',
                },
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
                    value:
                        'stage=unknown · type=networkbadstatus · code=4 · ' +
                        'disposition=terminal · HTTP 503',
                },
            ])
        );
        expect(renderedDetails).not.toContain('vhs-render-secret');
        expect(renderedDetails).not.toContain('provider.example');
        expect(renderedDetails).not.toContain('Authorization');
        expect(renderedDetails).not.toContain('response body');
    });

    it('renders only sanitized structured Shaka evidence in technical details', () => {
        const issue = createStructuredShakaDiagnostic();

        emitPlaybackIssue(issue);
        fixture.detectChanges();

        const details = getDiagnosticDetails(issue);
        const renderedDetails = details.map(({ value }) => value).join(' ');

        expect(details).toEqual(
            expect.arrayContaining([
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_SOURCE',
                    value: 'Shaka Player',
                },
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
                    value:
                        'stage=unknown · failure=network · ' +
                        'severity=recoverable · category=network · ' +
                        'code=1001 · disposition=terminal · HTTP 503',
                },
            ])
        );
        expect(renderedDetails).not.toContain('shaka-render-secret');
        expect(renderedDetails).not.toContain('provider.example');
        expect(renderedDetails).not.toContain('Authorization');
        expect(renderedDetails).not.toContain('response body');
    });

    it('renders only sanitized structured mpegts evidence in technical details', () => {
        const issue = createStructuredMpegTsDiagnostic();

        emitPlaybackIssue(issue);
        fixture.detectChanges();

        const details = getDiagnosticDetails(issue);
        const renderedDetails = details.map(({ value }) => value).join(' ');

        expect(getDiagnosticMeta(issue)).toBe('HTTP 404');
        expect(details).toEqual(
            expect.arrayContaining([
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_SOURCE',
                    value: 'mpegts.js',
                },
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
                    value:
                        'stage=loader · failure=http · type=NetworkError · ' +
                        'details=HttpStatusCodeInvalid · ' +
                        'disposition=terminal · HTTP 404',
                },
            ])
        );
        expect(renderedDetails).not.toContain('mpegts-render-secret');
        expect(renderedDetails).not.toContain('provider.example');
        expect(renderedDetails).not.toContain('Authorization');
        expect(renderedDetails).not.toContain('response body');
    });

    it('marks portal VOD playback as non-live for Video.js MPEG-TS playback', async () => {
        const streamUrl = 'https://example.com/movie/123.ts';
        fixture.componentRef.setInput('playback', {
            streamUrl,
            title: 'Example Movie',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 123,
                contentType: 'vod',
            },
        });

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const player = fixture.debugElement.query(
            By.directive(StubVjsPlayerComponent)
        ).componentInstance as StubVjsPlayerComponent;
        expect(player.options()).toEqual(
            expect.objectContaining({
                isLive: false,
                sources: [
                    {
                        src: streamUrl,
                        type: 'video/mp2t',
                    },
                ],
            })
        );
    });

    it('preserves playback HTTP metadata for channel-based players', async () => {
        const streamUrl = 'https://example.com/live/channel.m3u8';
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.Html5Player
        );
        fixture.componentRef.setInput('playback', {
            streamUrl,
            title: 'Header Locked Channel',
            userAgent: 'ProviderAgent/1.0',
            referer: 'https://provider.example/ref',
            origin: 'https://provider.example',
            headers: {
                'User-Agent': 'IgnoredFallbackAgent/1.0',
                Referer: 'https://ignored.example/ref',
                Origin: 'https://ignored.example',
            },
        });

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const player = fixture.debugElement.query(
            By.directive(StubHtmlVideoPlayerComponent)
        ).componentInstance as StubHtmlVideoPlayerComponent;
        expect(player.channel()).toEqual(
            expect.objectContaining({
                url: streamUrl,
                name: 'Header Locked Channel',
                http: {
                    'user-agent': 'ProviderAgent/1.0',
                    referrer: 'https://provider.example/ref',
                    origin: 'https://provider.example',
                },
            })
        );
    });

    it('falls back to playback headers when explicit HTTP metadata is absent', async () => {
        const streamUrl = 'https://example.com/live/channel.m3u8';
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.Html5Player
        );
        fixture.componentRef.setInput('playback', {
            streamUrl,
            title: 'Header Fallback Channel',
            headers: {
                'user-agent': 'HeaderAgent/1.0',
                referer: 'https://headers.example/ref',
                origin: 'https://headers.example',
            },
        });

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const player = fixture.debugElement.query(
            By.directive(StubHtmlVideoPlayerComponent)
        ).componentInstance as StubHtmlVideoPlayerComponent;
        expect(player.channel()).toEqual(
            expect.objectContaining({
                http: {
                    'user-agent': 'HeaderAgent/1.0',
                    referrer: 'https://headers.example/ref',
                    origin: 'https://headers.example',
                },
            })
        );
    });

    it('renders embedded MPV with an empty recording folder fallback', () => {
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.EmbeddedMpv
        );

        expect(() => fixture.detectChanges()).not.toThrow();

        const player = fixture.debugElement.query(
            By.directive(StubEmbeddedMpvPlayerComponent)
        ).componentInstance as StubEmbeddedMpvPlayerComponent;
        expect(player.recordingFolder()).toBe('');
    });

    describe('saved player changes', () => {
        // The selected engine must come from the live SettingsStore signal.
        // It used to come from a one-shot StorageMap snapshot taken at mount,
        // so a saved player change (settings page, command palette) never
        // reached an already-mounted Xtream/Stalker player.
        it('switches the mounted engine when the saved player changes', async () => {
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(
                fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            ).not.toBeNull();

            await TestBed.inject(SettingsStore).updateSettings({
                player: VideoPlayer.Html5Player,
            });
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(
                fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            ).toBeNull();
            expect(
                fixture.debugElement.query(
                    By.directive(StubHtmlVideoPlayerComponent)
                )
            ).not.toBeNull();
        });

        it('mounts the engine saved in the settings store on first render', async () => {
            const settingsStore = TestBed.inject(SettingsStore);
            await settingsStore.loadSettings();
            await settingsStore.updateSettings({
                player: VideoPlayer.ArtPlayer,
            });

            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(
                fixture.debugElement.query(By.directive(StubArtPlayerComponent))
            ).not.toBeNull();
            expect(
                fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            ).toBeNull();
        });

        it('retains the mounted engine when the saved player becomes MPV/VLC', async () => {
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(
                fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            ).not.toBeNull();

            // The view can neither render nor launch an external player, so
            // the switch must not blank the viewport; it applies when the
            // host starts the next playback.
            await TestBed.inject(SettingsStore).updateSettings({
                player: VideoPlayer.MPV,
            });
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(
                fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            ).not.toBeNull();

            // A later inline choice still applies live.
            await TestBed.inject(SettingsStore).updateSettings({
                player: VideoPlayer.Html5Player,
            });
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(
                fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            ).toBeNull();
            expect(
                fixture.debugElement.query(
                    By.directive(StubHtmlVideoPlayerComponent)
                )
            ).not.toBeNull();
        });

        it('keeps an explicit playerOverride ahead of the saved player', async () => {
            fixture.componentRef.setInput(
                'playerOverride',
                VideoPlayer.ArtPlayer
            );
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            await TestBed.inject(SettingsStore).updateSettings({
                player: VideoPlayer.Html5Player,
            });
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(
                fixture.debugElement.query(By.directive(StubArtPlayerComponent))
            ).not.toBeNull();
            expect(
                fixture.debugElement.query(
                    By.directive(StubHtmlVideoPlayerComponent)
                )
            ).toBeNull();
        });
    });

    it('suppresses browser diagnostics while embedded MPV is selected', () => {
        const requests: unknown[] = [];
        runtimeCapabilities.supportsManagedExternalPlayers = true;
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.EmbeddedMpv
        );
        component.externalFallbackRequested.subscribe((request) =>
            requests.push(request)
        );

        fixture.detectChanges();
        component.playbackDiagnostic.set(createUnsupportedCodecDiagnostic());
        fixture.detectChanges();
        component.requestRecommendedPlayer('mpv');

        expect(component.visiblePlaybackDiagnostic()).toBeNull();
        expect(
            fixture.debugElement.query(
                By.directive(StubEmbeddedMpvPlayerComponent)
            )
        ).not.toBeNull();
        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="playback-diagnostic-banner"]')
            )
        ).toBeNull();
        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="playback-fallback-mpv"]')
            )
        ).toBeNull();
        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="playback-fallback-vlc"]')
            )
        ).toBeNull();
        expect(requests).toEqual([]);
    });

    it('passes series navigation to embedded MPV and forwards episode navigation events', () => {
        const events: string[] = [];
        const seriesNavigation = {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        };
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.EmbeddedMpv
        );
        fixture.componentRef.setInput('seriesNavigation', seriesNavigation);
        (
            component as unknown as {
                playbackEnded: { subscribe: (fn: () => void) => void };
                previousEpisodeRequested: {
                    subscribe: (fn: () => void) => void;
                };
                nextEpisodeRequested: { subscribe: (fn: () => void) => void };
            }
        ).playbackEnded.subscribe(() => events.push('ended'));
        (
            component as unknown as {
                previousEpisodeRequested: {
                    subscribe: (fn: () => void) => void;
                };
            }
        ).previousEpisodeRequested.subscribe(() => events.push('previous'));
        (
            component as unknown as {
                nextEpisodeRequested: { subscribe: (fn: () => void) => void };
            }
        ).nextEpisodeRequested.subscribe(() => events.push('next'));

        fixture.detectChanges();

        const player = fixture.debugElement.query(
            By.directive(StubEmbeddedMpvPlayerComponent)
        ).componentInstance as StubEmbeddedMpvPlayerComponent;
        expect(player.seriesNavigation()).toBe(seriesNavigation);

        player.playbackEnded.emit();
        player.previousEpisodeRequested.emit();
        player.nextEpisodeRequested.emit();

        expect(events).toEqual(['ended', 'previous', 'next']);
    });

    it.each([
        {
            player: VideoPlayer.VideoJs,
            directive: StubVjsPlayerComponent,
        },
        {
            player: VideoPlayer.Html5Player,
            directive: StubHtmlVideoPlayerComponent,
        },
        {
            player: VideoPlayer.ArtPlayer,
            directive: StubArtPlayerComponent,
        },
    ])(
        'passes volume to $player inline player',
        async ({ player, directive }) => {
            fixture.componentRef.setInput('playerOverride', player);
            fixture.componentRef.setInput('volume', 0.42);

            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            const playerElement = fixture.debugElement.query(
                By.directive(directive)
            );
            expect(playerElement).not.toBeNull();

            const playerInstance = playerElement.componentInstance as {
                volume: () => number;
            };
            expect(playerInstance.volume()).toBe(0.42);
        }
    );

    it.each([
        {
            player: VideoPlayer.VideoJs,
            directive: StubVjsPlayerComponent,
        },
        {
            player: VideoPlayer.Html5Player,
            directive: StubHtmlVideoPlayerComponent,
        },
        {
            player: VideoPlayer.ArtPlayer,
            directive: StubArtPlayerComponent,
        },
    ])(
        'passes series navigation to $player and forwards episode navigation events',
        async ({ player: selectedPlayer, directive }) => {
            const events: string[] = [];
            const seriesNavigation = {
                canPrevious: true,
                canNext: false,
                autoplayEnabled: true,
            };
            fixture.componentRef.setInput('playerOverride', selectedPlayer);
            fixture.componentRef.setInput('seriesNavigation', seriesNavigation);
            component.playbackEnded.subscribe(() => events.push('ended'));
            component.previousEpisodeRequested.subscribe(() =>
                events.push('previous')
            );
            component.nextEpisodeRequested.subscribe(() => events.push('next'));

            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            const playerElement = fixture.debugElement.query(
                By.directive(directive)
            );
            expect(playerElement).not.toBeNull();

            const player = playerElement.componentInstance as {
                seriesNavigation: () => unknown;
                playbackEnded: { emit: () => void };
                previousEpisodeRequested: { emit: () => void };
                nextEpisodeRequested: { emit: () => void };
            };
            expect(player.seriesNavigation()).toBe(seriesNavigation);

            player.playbackEnded.emit();
            player.previousEpisodeRequested.emit();
            player.nextEpisodeRequested.emit();

            expect(events).toEqual(['ended', 'previous', 'next']);
        }
    );

    it('uses the PWA browser access diagnostic description key outside desktop', () => {
        const issue = createBrowserAccessDiagnostic();

        expect(getDiagnosticTitleKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.TITLE'
        );
        expect(getDiagnosticDescriptionKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.PWA_DESCRIPTION'
        );
    });

    it('keeps the desktop browser access diagnostic description key', () => {
        runtimeCapabilities.supportsManagedExternalPlayers = true;
        const issue = createBrowserAccessDiagnostic();

        expect(getDiagnosticDescriptionKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.DESCRIPTION'
        );
    });

    it('uses an inline recovery headline when external fallback actions are unavailable', () => {
        fixture.detectChanges();
        emitPlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();

        const banner = fixture.debugElement.query(
            By.css('[data-test-id="playback-diagnostic-banner"]')
        );
        const mpvButton = fixture.debugElement.query(
            By.css('[data-test-id="playback-fallback-mpv"]')
        );

        expect(mpvButton).toBeNull();
        expect(banner.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.NETWORK_ERROR.TITLE'
        );
        expect(banner.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.INLINE_FAILURE_TITLE'
        );
    });

    it('renders technical details and codec-specific hints in the diagnostic banner', () => {
        fixture.detectChanges();
        const issue = createUnsupportedCodecDiagnostic();

        emitPlaybackIssue(issue);
        fixture.detectChanges();

        const details = fixture.debugElement.query(
            By.css('[data-test-id="playback-diagnostic-details"]')
        );
        const codecHint = fixture.debugElement.query(
            By.css('[data-test-id="playback-codec-hint"]')
        );

        expect(details.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.DETAILS_SUMMARY'
        );
        expect(getDiagnosticCodecHint(issue)).toBe('HEVC, AC-3');
        expect(getDiagnosticDetails(issue)).toEqual(
            expect.arrayContaining([
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_CODE',
                    value: 'unsupported-codec',
                },
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_PLAYER',
                    value: 'Video.js',
                },
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_VIDEO_CODECS',
                    value: 'hvc1.1.6.L93.B0',
                },
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_AUDIO_CODECS',
                    value: 'ac-3',
                },
            ])
        );
        expect(codecHint.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.CODEC_HINT'
        );
    });

    it('clears playback diagnostics when retrying inline playback', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const player = fixture.debugElement.query(
            By.directive(StubVjsPlayerComponent)
        ).componentInstance as StubVjsPlayerComponent;
        expect(player.options()).toEqual(
            expect.objectContaining({ reloadToken: 0 })
        );

        emitPlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();

        const retryButton = fixture.debugElement.query(
            By.css('[data-test-id="playback-retry"]')
        );
        const utilityControls = fixture.nativeElement.querySelectorAll(
            '[data-test-id="playback-retry"], [data-test-id="playback-diagnostic-details"]'
        );

        expect(utilityControls[0]).toBe(retryButton.nativeElement);

        retryButton.nativeElement.click();
        fixture.detectChanges();
        const retriedPlayer = fixture.debugElement.query(
            By.directive(StubVjsPlayerComponent)
        ).componentInstance as StubVjsPlayerComponent;

        expect(component.playbackDiagnostic()).toBeNull();
        expect(retriedPlayer.options()).toEqual(
            expect.objectContaining({ reloadToken: 1 })
        );
        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="playback-diagnostic-banner"]')
            )
        ).toBeNull();
    });

    describe('Electron scoped header override ownership', () => {
        const GATED_STREAM_URL = 'http://portal.example:8080/live/ch1.ts';
        const GATED_PLAYBACK = {
            streamUrl: GATED_STREAM_URL,
            title: 'Gated Channel',
            isLive: true,
            headers: {
                'User-Agent': 'MAG250',
                Referer: 'http://portal.example',
                Cookie: 'mac=00%3A1A%3A79%3A00%3A00%3A01; stb_lang=en_US',
                Authorization: 'Bearer TOKEN123',
            },
        };
        let setUserAgent: jest.Mock;

        beforeEach(() => {
            setUserAgent = jest.fn().mockResolvedValue(true);
            (window as unknown as { electron?: unknown }).electron = {
                setUserAgent,
            };
        });

        afterEach(() => {
            fixture.destroy();
            delete (window as unknown as { electron?: unknown }).electron;
        });

        it('configures the full header set — incl. credentials — before handing the source to the player', async () => {
            fixture.componentRef.setInput('playback', GATED_PLAYBACK);

            fixture.detectChanges();

            // The source is handed over only after the override IPC resolves,
            // so the first media request already carries the credentials.
            expect(setUserAgent).toHaveBeenCalledWith(
                'MAG250',
                'http://portal.example',
                GATED_STREAM_URL,
                {
                    authorization: 'Bearer TOKEN123',
                    cookie: 'mac=00%3A1A%3A79%3A00%3A00%3A01; stb_lang=en_US',
                }
            );
            expect(component.channel()).toBeUndefined();

            await fixture.whenStable();
            fixture.detectChanges();

            expect(component.channel()?.url).toBe(GATED_STREAM_URL);
        });

        it('omits the credentials object when the playback carries none', async () => {
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/live/plain.m3u8',
                title: 'Plain Channel',
                userAgent: 'PlainAgent/1.0',
            });

            fixture.detectChanges();
            await fixture.whenStable();

            expect(setUserAgent).toHaveBeenCalledWith(
                'PlainAgent/1.0',
                undefined,
                'https://example.com/live/plain.m3u8',
                undefined
            );
        });

        it('applies only the newest playback when a switch supersedes a pending header IPC', async () => {
            const resolvers: Array<() => void> = [];
            setUserAgent.mockImplementation(
                () =>
                    new Promise<boolean>((resolve) =>
                        resolvers.push(() => resolve(true))
                    )
            );

            fixture.componentRef.setInput('playback', GATED_PLAYBACK);
            fixture.detectChanges();
            fixture.componentRef.setInput('playback', {
                streamUrl: 'http://portal.example:8080/live/ch2.ts',
                title: 'Next Channel',
                isLive: true,
                headers: GATED_PLAYBACK.headers,
            });
            fixture.detectChanges();

            // The stale IPC completion must not hand the old source over.
            resolvers[0]();
            await fixture.whenStable();
            expect(component.channel()).toBeUndefined();

            resolvers[1]();
            await fixture.whenStable();
            expect(component.channel()?.url).toBe(
                'http://portal.example:8080/live/ch2.ts'
            );
        });

        it('clears the scoped override on destroy so credentials do not outlive playback', async () => {
            fixture.componentRef.setInput('playback', GATED_PLAYBACK);
            fixture.detectChanges();
            await fixture.whenStable();
            setUserAgent.mockClear();

            fixture.destroy();

            expect(setUserAgent).toHaveBeenCalledWith(
                undefined,
                undefined,
                GATED_STREAM_URL
            );
        });
    });

    function emitPlaybackIssue(issue: PlaybackDiagnostic | null): void {
        fixture.detectChanges();
        const binding = component.activeBinding();
        expect(binding).not.toBeNull();
        if (!binding) {
            throw new Error('Expected an active inline playback binding');
        }
        component.handlePlaybackIssue(issue, binding);
    }

    function getDiagnosticDescriptionKey(issue: PlaybackDiagnostic): string {
        return resolveDiagnosticDescriptionKey(
            issue,
            runtimeCapabilities.supportsManagedExternalPlayers,
            true
        );
    }
});

function createUnsupportedContainerDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.UnsupportedContainer,
        source: PlaybackDiagnosticSource.Native,
        sourceUrl: 'https://example.com/archive/movie.mkv',
        container: 'mkv',
        mimeType: 'video/matroska',
        player: 'videojs',
        audioCodecs: [],
        videoCodecs: [],
    };
}

function createBrowserAccessDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.BrowserAccessError,
        source: PlaybackDiagnosticSource.Hls,
        sourceUrl: 'https://provider.example/live.m3u8',
        container: 'm3u8',
        mimeType: 'application/x-mpegURL',
        player: 'videojs',
        audioCodecs: [],
        videoCodecs: [],
        details: 'blocked by CORS policy',
    };
}

function createUnsupportedCodecDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.UnsupportedCodec,
        source: PlaybackDiagnosticSource.Hls,
        sourceUrl: 'https://example.com/live/index.m3u8',
        container: 'm3u8',
        mimeType: 'application/x-mpegURL',
        player: 'videojs',
        audioCodecs: ['ac-3'],
        videoCodecs: ['hvc1.1.6.L93.B0'],
        details: 'manifestIncompatibleCodecsError',
    };
}

function createNetworkDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.MpegTs,
        sourceUrl: 'https://example.com/live/channel.ts',
        container: 'ts',
        mimeType: 'video/mp2t',
        player: 'videojs',
        audioCodecs: [],
        videoCodecs: [],
        details: 'HttpStatusCodeInvalid {"code":456,"msg":"<none>"}',
    };
}

function createHttpDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Native,
        sourceUrl: 'https://example.com/live/missing.m3u8',
        container: 'm3u8',
        mimeType: 'application/x-mpegURL',
        player: 'videojs',
        audioCodecs: [],
        videoCodecs: [],
        nativeErrorCode: 4,
        nativeErrorMessage: 'source not supported',
        httpStatus: 404,
        nativeErrorType: 'networkrequestfailed',
    };
}

function createStructuredHlsDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Hls,
        sourceUrl:
            'https://provider.example/live.m3u8?token=diagnostic-url-secret',
        container: 'm3u8',
        mimeType: 'application/x-mpegURL',
        player: 'html5',
        audioCodecs: [],
        videoCodecs: [],
        httpStatus: 404,
        hls: {
            engineType: ErrorTypes.NETWORK_ERROR,
            engineDetails: ErrorDetails.MANIFEST_LOAD_ERROR,
            disposition: 'fatal',
            stage: 'manifest',
            failure: 'http',
            httpStatus: 404,
        },
    };
}

function createStructuredVhsDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Vhs,
        sourceUrl: 'https://provider.example/live.m3u8?token=vhs-render-secret',
        container: 'm3u8',
        mimeType: 'application/x-mpegURL',
        player: 'videojs',
        audioCodecs: [],
        videoCodecs: [],
        details: 'Authorization response body vhs-render-secret',
        nativeErrorCode: 4,
        nativeErrorMessage:
            'https://provider.example/error?token=vhs-render-secret',
        httpStatus: 503,
        vhs: {
            engineType: 'networkbadstatus',
            mediaErrorCode: 4,
            disposition: 'terminal',
            stage: 'unknown',
            httpStatus: 503,
        },
    };
}

function createStructuredShakaDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Shaka,
        sourceUrl:
            'https://provider.example/live.mpd?token=shaka-render-secret',
        container: 'mpd',
        mimeType: 'application/dash+xml',
        player: 'artplayer',
        audioCodecs: [],
        videoCodecs: [],
        details: 'Authorization response body shaka-render-secret',
        nativeErrorMessage:
            'https://provider.example/error?token=shaka-render-secret',
        httpStatus: 503,
        shaka: {
            severity: 'recoverable',
            category: 'network',
            engineCode: 1001,
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'network',
            httpStatus: 503,
        },
    };
}

function createStructuredMpegTsDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.MpegTs,
        sourceUrl:
            'https://provider.example/live.ts?token=mpegts-render-secret',
        container: 'ts',
        mimeType: 'video/mp2t',
        player: 'html5',
        audioCodecs: [],
        videoCodecs: [],
        details: 'Authorization response body mpegts-render-secret',
        nativeErrorMessage:
            'https://provider.example/error?token=mpegts-render-secret',
        httpStatus: 404,
        mpegTs: {
            engineType: 'NetworkError',
            engineDetails: 'HttpStatusCodeInvalid',
            disposition: 'terminal',
            stage: 'loader',
            failure: 'http',
            httpStatus: 404,
        },
    };
}
