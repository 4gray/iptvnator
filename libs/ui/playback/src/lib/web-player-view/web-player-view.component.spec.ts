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
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';
import {
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '../playback-diagnostics/playback-diagnostics.util';

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
    readonly volume = input(1);
    readonly startTime = input(0);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
}

@Component({
    selector: 'app-html-video-player',
    template: '<div data-test-id="stub-html-player"></div>',
})
class StubHtmlVideoPlayerComponent {
    readonly channel = input<unknown>();
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly startTime = input(0);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
}

@Component({
    selector: 'app-art-player',
    template: '<div data-test-id="stub-art-player"></div>',
})
class StubArtPlayerComponent {
    readonly channel = input<unknown>();
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly startTime = input(0);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
}

@Component({
    selector: 'app-embedded-mpv-player',
    template: '<div data-test-id="stub-embedded-mpv-player"></div>',
})
class StubEmbeddedMpvPlayerComponent {
    readonly playback = input.required<unknown>();
    readonly recordingFolder = input('');
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

describe('WebPlayerViewComponent', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let component: WebPlayerViewComponentInstance;
    const storageMap = {
        get: jest.fn(() => of({ player: VideoPlayer.VideoJs })),
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

    it('renders diagnostics and emits MPV fallback requests when managed external players are available', () => {
        const requests: unknown[] = [];
        runtimeCapabilities.supportsManagedExternalPlayers = true;
        component.externalFallbackRequested.subscribe((request) =>
            requests.push(request)
        );

        fixture.detectChanges();
        component.handlePlaybackIssue(createUnsupportedContainerDiagnostic());
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

    it('keeps query-declared HLS streams on the HLS mime type', () => {
        const streamUrl =
            'https://example.com/play?extension=m3u8&token=signed';

        component.setVjsOptions(streamUrl);

        expect(component.vjsOptions.sources).toEqual([
            {
                src: streamUrl,
                type: 'application/x-mpegURL',
            },
        ]);
    });

    it('treats web script playback URLs without declared media extension as MPEG-TS', () => {
        const streamUrl = 'https://example.com/live.php?stream=123&token=x';

        component.setVjsOptions(streamUrl);

        expect(component.vjsOptions.sources).toEqual([
            {
                src: streamUrl,
                type: 'video/mp2t',
            },
        ]);
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

    it('renders embedded MPV before settings storage emits', () => {
        fixture.destroy();

        const pendingSettings = new Subject<unknown>();
        storageMap.get.mockReturnValue(pendingSettings.asObservable());
        fixture = TestBed.createComponent(WebPlayerViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput(
            'streamUrl',
            'https://example.com/archive/movie.mkv'
        );
        fixture.componentRef.setInput('title', 'Example Movie');
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

    it('suppresses browser diagnostics while embedded MPV is selected', () => {
        const requests: unknown[] = [];
        runtimeCapabilities.supportsManagedExternalPlayers = true;
        fixture.componentRef.setInput('playerOverride', VideoPlayer.EmbeddedMpv);
        component.externalFallbackRequested.subscribe((request) =>
            requests.push(request)
        );

        fixture.detectChanges();
        component.handlePlaybackIssue(createUnsupportedCodecDiagnostic());
        fixture.detectChanges();
        component.requestExternalFallback('mpv');

        expect(component.playbackDiagnostic()).toBeNull();
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

    it('uses the PWA browser access diagnostic description key outside desktop', () => {
        const issue = createBrowserAccessDiagnostic();

        expect(component.getDiagnosticTitleKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.TITLE'
        );
        expect(component.getDiagnosticDescriptionKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.PWA_DESCRIPTION'
        );
    });

    it('keeps the desktop browser access diagnostic description key', () => {
        runtimeCapabilities.supportsManagedExternalPlayers = true;
        const issue = createBrowserAccessDiagnostic();

        expect(component.getDiagnosticDescriptionKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.DESCRIPTION'
        );
    });

    it('uses an inline recovery headline when external fallback actions are unavailable', () => {
        fixture.detectChanges();
        component.handlePlaybackIssue(createNetworkDiagnostic());
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

        component.handlePlaybackIssue(issue);
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
        expect(component.getDiagnosticCodecHint(issue)).toBe('HEVC, AC-3');
        expect(component.getDiagnosticDetails(issue)).toEqual(
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

        component.handlePlaybackIssue(createUnsupportedCodecDiagnostic());
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

        expect(component.playbackDiagnostic()).toBeNull();
        expect(player.options()).toEqual(
            expect.objectContaining({ reloadToken: 1 })
        );
        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="playback-diagnostic-banner"]')
            )
        ).toBeNull();
    });
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
        externalFallbackRecommended: true,
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
        externalFallbackRecommended: true,
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
        externalFallbackRecommended: true,
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
        externalFallbackRecommended: false,
    };
}
