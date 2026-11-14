import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '@iptvnator/playback/util';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';
import {
    StubArtPlayerComponent,
    StubEmbeddedMpvPlayerComponent,
    StubFullscreenChannelPanelComponent,
    StubHtmlVideoPlayerComponent,
    StubVjsPlayerComponent,
} from './web-player-view.spec-stubs';
import { PlaybackDiagnosticPanelComponent } from '../playback-diagnostic-panel/playback-diagnostic-panel.component';
import { isExternalPlayerRecommendation } from '../playback-diagnostic-panel/playback-recommendation-view.util';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

const STREAM_URL = 'https://stream.example/live/tile.m3u8';

function unsupportedContainer(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.UnsupportedContainer,
        source: PlaybackDiagnosticSource.Native,
        sourceUrl: STREAM_URL,
        container: 'mkv',
        mimeType: 'video/matroska',
        player: 'html5',
        audioCodecs: [],
        videoCodecs: [],
    };
}

const flushMutations = () =>
    new Promise<void>((resolve) => setTimeout(resolve));

describe('WebPlayerViewComponent tile mode', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let component: WebPlayerViewComponentInstance;

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    const runtime = { supportsManagedExternalPlayers: false };

    beforeEach(async () => {
        runtime.supportsManagedExternalPlayers = false;
        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: StorageMap,
                    useValue: {
                        get: () => of({ player: VideoPlayer.Html5Player }),
                        set: () => of(undefined),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
            ],
        })
            .overrideComponent(WebPlayerViewComponent, {
                set: {
                    imports: [
                        StubArtPlayerComponent,
                        StubEmbeddedMpvPlayerComponent,
                        StubFullscreenChannelPanelComponent,
                        StubHtmlVideoPlayerComponent,
                        StubVjsPlayerComponent,
                        PlaybackDiagnosticPanelComponent,
                        TranslateModule,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WebPlayerViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('playbackSessionKey', 'tile-session');
        fixture.componentRef.setInput('streamUrl', STREAM_URL);
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.Html5Player
        );
        fixture.componentRef.setInput('playback', {
            streamUrl: STREAM_URL,
            title: 'Synthetic tile',
            isLive: true,
        });
    });

    afterEach(() => {
        fixture.destroy();
        jest.restoreAllMocks();
    });

    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    function engine(): StubHtmlVideoPlayerComponent {
        return fixture.debugElement.query(
            By.directive(StubHtmlVideoPlayerComponent)
        ).componentInstance;
    }

    function channelPanel(): StubFullscreenChannelPanelComponent {
        return fixture.debugElement.query(
            By.directive(StubFullscreenChannelPanelComponent)
        ).componentInstance;
    }

    function raiseIssue(issue: PlaybackDiagnostic): void {
        fixture.detectChanges();
        const binding = component.activeBinding();
        if (!binding) throw new Error('Expected an active binding');
        component.handlePlaybackIssue(issue, binding);
        fixture.detectChanges();
    }

    const banner = () =>
        fixture.debugElement.query(
            By.css('[data-test-id="playback-diagnostic-banner"]')
        );

    describe('external players (MPV, VLC)', () => {
        const offersExternal = () =>
            component.recommendations().some(isExternalPlayerRecommendation);

        beforeEach(() => {
            runtime.supportsManagedExternalPlayers = true;
        });

        it('are offered by a single player as before', () => {
            raiseIssue(unsupportedContainer());

            expect(offersExternal()).toBe(true);
            expect(component.supportsManagedExternalPlayers).toBe(true);
        });

        it('are not offered by a tile, which has no handoff to them', () => {
            // The main tile keeps full chrome and the diagnostic panel.
            fixture.componentRef.setInput('muted', false);
            fixture.componentRef.setInput('paused', false);
            raiseIssue(unsupportedContainer());

            expect(banner()).not.toBeNull();
            expect(offersExternal()).toBe(false);
            expect(component.supportsManagedExternalPlayers).toBe(false);
        });
    });

    describe('with no tile inputs set', () => {
        it('keeps engine interaction, panels and host classes as before', async () => {
            await render();

            expect(engine().interactionEnabled()).toBe(true);
            expect(channelPanel().enabled()).toBe(true);
            expect(fixture.nativeElement.classList).not.toContain(
                'web-player-view--chromeless'
            );
        });

        it('still renders the diagnostic panel', () => {
            raiseIssue(unsupportedContainer());

            expect(banner()).not.toBeNull();
        });

        it('does not touch the media element', async () => {
            fixture.detectChanges();
            const video = document.createElement('video');
            fixture.nativeElement.appendChild(video);
            await flushMutations();
            fixture.detectChanges();

            expect(video.muted).toBe(false);
        });
    });

    describe.each(['minimal', 'none'] as const)('controlsMode %s', (mode) => {
        beforeEach(() => {
            fixture.componentRef.setInput('controlsMode', mode);
        });

        it('turns off engine interaction and the fullscreen channel panel', async () => {
            await render();

            expect(engine().interactionEnabled()).toBe(false);
            expect(channelPanel().enabled()).toBe(false);
            expect(fixture.nativeElement.classList).toContain(
                'web-player-view--chromeless'
            );
        });

        it('hands the diagnostic to the tile instead of rendering the panel', () => {
            const reported: (PlaybackDiagnostic | null)[] = [];
            const failed: PlaybackDiagnosticCode[] = [];
            component.diagnosticChanged.subscribe((d) => reported.push(d));
            component.playbackFailed.subscribe((code) => failed.push(code));
            const issue = unsupportedContainer();

            raiseIssue(issue);

            expect(banner()).toBeNull();
            expect(reported).toEqual([issue]);
            expect(failed).toEqual([
                PlaybackDiagnosticCode.UnsupportedContainer,
            ]);
        });
    });

    it('restores full chrome when the tile becomes the main tile again', async () => {
        fixture.componentRef.setInput('controlsMode', 'minimal');
        await render();
        fixture.componentRef.setInput('controlsMode', 'full');
        fixture.detectChanges();

        expect(engine().interactionEnabled()).toBe(true);
        expect(fixture.nativeElement.classList).not.toContain(
            'web-player-view--chromeless'
        );
    });

    describe('session-managed media', () => {
        let video: HTMLVideoElement;

        beforeEach(() => {
            jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
                () => undefined
            );
            jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(
                undefined
            );
            jest.spyOn(
                HTMLMediaElement.prototype,
                'paused',
                'get'
            ).mockReturnValue(false);
            fixture.detectChanges();
            video = document.createElement('video');
            fixture.nativeElement.appendChild(video);
        });

        it('mutes and pauses the engine video when the session holds the tile', async () => {
            fixture.componentRef.setInput('muted', true);
            fixture.componentRef.setInput('paused', true);
            fixture.detectChanges();
            await flushMutations();

            expect(video.muted).toBe(true);
            expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
        });

        it('reports the viewer unmuting a muted tile as an audio request', () => {
            let requests = 0;
            component.audioRequested.subscribe(() => (requests += 1));
            fixture.componentRef.setInput('muted', true);
            fixture.detectChanges();

            fixture.nativeElement.dispatchEvent(
                new Event('pointerdown', { bubbles: true })
            );
            video.muted = false;
            video.dispatchEvent(new Event('volumechange'));

            expect(requests).toBe(1);
            expect(video.muted).toBe(true);
        });

        it('releases the media element when the view is destroyed', () => {
            fixture.componentRef.setInput('muted', true);
            fixture.detectChanges();
            fixture.destroy();

            video.muted = false;
            video.dispatchEvent(new Event('volumechange'));

            expect(video.muted).toBe(false);
        });
    });
});
