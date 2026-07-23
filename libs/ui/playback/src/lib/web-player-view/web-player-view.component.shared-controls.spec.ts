import { ClipboardModule } from '@angular/cdk/clipboard';
import { Component, input, output, signal } from '@angular/core';
import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls';
import {
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '../playback-diagnostics/playback-diagnostics.util';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({ selector: 'app-vjs-player', template: '' })
class StubVjsPlayerComponent {
    readonly options = input<unknown>();
    readonly volume = input(1);
    readonly localTimeshiftActive = input(false);
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

@Component({ selector: 'app-html-video-player', template: '' })
class StubHtmlVideoPlayerComponent {
    readonly channel = input<unknown>();
    readonly volume = input(1);
    readonly localTimeshiftActive = input(false);
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

@Component({ selector: 'app-art-player', template: '' })
class StubArtPlayerComponent {
    readonly channel = input<unknown>();
    readonly volume = input(1);
    readonly localTimeshiftActive = input(false);
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

@Component({ selector: 'app-embedded-mpv-player', template: '' })
class StubEmbeddedMpvPlayerComponent {
    readonly playback = input.required<unknown>();
    readonly localTimeshiftActive = input(false);
    readonly recordingFolder = input('');
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

const webPlayerSharedControls = signal(false);

describe('WebPlayerViewComponent shared web controls metadata', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let component: WebPlayerViewComponentInstance;

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    beforeEach(async () => {
        webPlayerSharedControls.set(false);

        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: StorageMap,
                    useValue: {
                        get: jest.fn(() => of({ player: VideoPlayer.VideoJs })),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: false },
                },
                {
                    provide: SettingsStore,
                    useValue: { webPlayerSharedControls },
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
                        MatProgressSpinnerModule,
                        MatTooltipModule,
                        TranslateModule,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WebPlayerViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput(
            'streamUrl',
            'https://example.com/default.ts'
        );
        fixture.componentRef.setInput('title', 'Default stream');
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('snapshots the shared controls setting for each player host', () => {
        webPlayerSharedControls.set(true);
        fixture.detectChanges();

        expect(
            fixture.debugElement.injector.get(WEB_PLAYER_SHARED_CONTROLS)
        ).toBe(true);

        webPlayerSharedControls.set(false);

        expect(
            fixture.debugElement.injector.get(WEB_PLAYER_SHARED_CONTROLS)
        ).toBe(true);

        fixture.destroy();
        fixture = TestBed.createComponent(WebPlayerViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput(
            'streamUrl',
            'https://example.com/next.ts'
        );
        fixture.detectChanges();

        expect(
            fixture.debugElement.injector.get(WEB_PLAYER_SHARED_CONTROLS)
        ).toBe(false);
    });

    it.each([
        ['an explicit VOD value', { isLive: false }, false],
        [
            'an explicit live value with VOD content metadata',
            { isLive: true, contentInfo: createVodContentInfo() },
            true,
        ],
        [
            'VOD content metadata without an explicit value',
            { contentInfo: createVodContentInfo() },
            false,
        ],
        ['missing content metadata and explicit value', {}, true],
    ])('resolves %s', (_label, metadata, expected) => {
        setPlayback(metadata);

        expect(component.resolvedIsLive()).toBe(expected);
    });

    it('passes the resolved live value to the HTML5 player', async () => {
        const htmlPlayer = await renderHtmlPlayer({ isLive: false });

        expect(htmlPlayer.isLive()).toBe(false);
    });

    it('passes resolved playback metadata and caption preference to Video.js', async () => {
        fixture.componentRef.setInput('showCaptions', true);

        const vjsPlayer = await renderVjsPlayer({ isLive: false });

        expect(vjsPlayer.options()).toEqual(
            expect.objectContaining({ isLive: false })
        );
        expect(vjsPlayer.showCaptions()).toBe(true);
        expect(vjsPlayer.interactionEnabled()).toBe(true);
    });

    it('passes resolved playback metadata and diagnostic interaction state to ArtPlayer', async () => {
        fixture.componentRef.setInput('showCaptions', true);

        const artPlayer = await renderArtPlayer({ isLive: false });

        expect(artPlayer.isLive()).toBe(false);
        expect(artPlayer.showCaptions()).toBe(true);
        expect(artPlayer.interactionEnabled()).toBe(true);

        component.handlePlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(artPlayer.interactionEnabled()).toBe(false);

        component.handlePlaybackIssue(null);
        fixture.detectChanges();
        expect(artPlayer.interactionEnabled()).toBe(true);
    });

    it('disables HTML5 surface interaction while a diagnostic is visible', async () => {
        const htmlPlayer = await renderHtmlPlayer();

        component.handlePlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();

        expect(component.playbackInteractionEnabled()).toBe(false);
        expect(htmlPlayer.interactionEnabled()).toBe(false);
    });

    it('re-enables HTML5 interaction after retrying or clearing the issue', async () => {
        const htmlPlayer = await renderHtmlPlayer();

        component.handlePlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(htmlPlayer.interactionEnabled()).toBe(false);

        component.retryPlayback();
        fixture.detectChanges();
        expect(component.playbackInteractionEnabled()).toBe(true);
        expect(htmlPlayer.interactionEnabled()).toBe(true);

        component.handlePlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(htmlPlayer.interactionEnabled()).toBe(false);

        component.handlePlaybackIssue(null);
        fixture.detectChanges();
        expect(component.playbackInteractionEnabled()).toBe(true);
        expect(htmlPlayer.interactionEnabled()).toBe(true);
    });

    it('disables and restores Video.js interaction around diagnostics', async () => {
        const vjsPlayer = await renderVjsPlayer();

        component.handlePlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(vjsPlayer.interactionEnabled()).toBe(false);

        component.retryPlayback();
        fixture.detectChanges();
        expect(vjsPlayer.interactionEnabled()).toBe(true);

        component.handlePlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(vjsPlayer.interactionEnabled()).toBe(false);

        component.handlePlaybackIssue(null);
        fixture.detectChanges();
        expect(vjsPlayer.interactionEnabled()).toBe(true);
    });

    it.each([
        ['inferred VOD', { contentInfo: createVodContentInfo() }, false],
        [
            'explicit live VOD content',
            { isLive: true, contentInfo: createVodContentInfo() },
            true,
        ],
    ])(
        'uses the resolved value for Video.js effect and retry: %s',
        (_label, metadata, expected) => {
            const streamUrl = 'https://example.com/video.ts';
            const setVjsOptions = jest.spyOn(component, 'setVjsOptions');
            setPlayback(metadata, streamUrl);

            fixture.detectChanges();

            expect(setVjsOptions).toHaveBeenCalledWith(streamUrl, expected);

            setVjsOptions.mockClear();
            component.retryPlayback();

            expect(setVjsOptions).toHaveBeenCalledWith(streamUrl, expected);
        }
    );

    function setPlayback(
        metadata: Partial<ResolvedPortalPlayback>,
        streamUrl = 'https://example.com/playback.ts'
    ): void {
        fixture.componentRef.setInput('playback', {
            streamUrl,
            title: 'Playback',
            ...metadata,
        });
    }

    async function renderHtmlPlayer(
        metadata: Partial<ResolvedPortalPlayback> = {}
    ): Promise<StubHtmlVideoPlayerComponent> {
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.Html5Player
        );
        setPlayback(metadata);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        return fixture.debugElement.query(
            By.directive(StubHtmlVideoPlayerComponent)
        ).componentInstance as StubHtmlVideoPlayerComponent;
    }

    async function renderVjsPlayer(
        metadata: Partial<ResolvedPortalPlayback> = {}
    ): Promise<StubVjsPlayerComponent> {
        fixture.componentRef.setInput('playerOverride', VideoPlayer.VideoJs);
        setPlayback(metadata);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        return fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            .componentInstance as StubVjsPlayerComponent;
    }

    async function renderArtPlayer(
        metadata: Partial<ResolvedPortalPlayback> = {}
    ): Promise<StubArtPlayerComponent> {
        fixture.componentRef.setInput('playerOverride', VideoPlayer.ArtPlayer);
        setPlayback(metadata);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        return fixture.debugElement.query(By.directive(StubArtPlayerComponent))
            .componentInstance as StubArtPlayerComponent;
    }
});

function createVodContentInfo() {
    return {
        playlistId: 'playlist-1',
        contentXtreamId: 123,
        contentType: 'vod' as const,
    };
}

function createNetworkDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.MpegTs,
        sourceUrl: 'https://example.com/playback.ts',
        container: 'ts',
        mimeType: 'video/mp2t',
        player: 'html5',
        audioCodecs: [],
        videoCodecs: [],
        externalFallbackRecommended: false,
    };
}
