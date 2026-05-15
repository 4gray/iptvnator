import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
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
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
}

describe('WebPlayerViewComponent', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let component: WebPlayerViewComponentInstance;
    const storageMap = {
        get: jest.fn(() => of({ player: VideoPlayer.VideoJs })),
    };
    const originalElectron = window.electron;

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [{ provide: StorageMap, useValue: storageMap }],
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
        window.electron = originalElectron;
        fixture.destroy();
    });

    it('anchors overlay UI to the player view host', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.classList).toContain('web-player-view');
    });

    it('renders diagnostics and emits MPV fallback requests on desktop', () => {
        const requests: unknown[] = [];
        fixture.destroy();
        window.electron = {} as typeof window.electron;
        fixture = TestBed.createComponent(WebPlayerViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput(
            'streamUrl',
            'https://example.com/archive/movie.mkv'
        );
        fixture.componentRef.setInput('title', 'Example Movie');
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

    it('marks portal VOD playback as non-live for Video.js MPEG-TS playback', () => {
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

    it('uses browser access diagnostic translation keys', () => {
        const issue = createBrowserAccessDiagnostic();

        expect(component.getDiagnosticTitleKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.TITLE'
        );
        expect(component.getDiagnosticDescriptionKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.DESCRIPTION'
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
