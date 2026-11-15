import {
    ComponentFixture,
    TestBed,
    DeferBlockBehavior,
} from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '@iptvnator/playback/util';
import {
    StubArtPlayerComponent,
    StubEmbeddedMpvPlayerComponent,
    StubFullscreenChannelPanelComponent,
    StubHtmlVideoPlayerComponent,
    StubVjsPlayerComponent,
} from './web-player-view.spec-stubs';
import type { WebPlayerViewComponent as WebPlayerView } from './web-player-view.component';

jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

describe('returning from the Android live player', () => {
    let fixture: ComponentFixture<WebPlayerView>;
    let postMessage: jest.Mock;
    const playback = {
        streamUrl: 'https://media.example.test/synthetic-channel.m3u8',
        title: 'Synthetic channel',
        isLive: true,
    };

    beforeEach(async () => {
        postMessage = jest.fn();
        Object.assign(window, {
            TvShell: { postMessage },
            iptvnatorAndroidPlaybackLabels: { open: 'Open', back: 'Back' },
        });
        const { WebPlayerViewComponent } =
            await import('./web-player-view.component');
        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent],
            providers: [
                {
                    provide: StorageMap,
                    useValue: {
                        get: () => of({ player: VideoPlayer.VideoJs }),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: false },
                },
            ],
        })
            .overrideComponent(WebPlayerViewComponent, {
                set: {
                    imports: [
                        MatButtonModule,
                        StubArtPlayerComponent,
                        StubEmbeddedMpvPlayerComponent,
                        StubFullscreenChannelPanelComponent,
                        StubHtmlVideoPlayerComponent,
                        StubVjsPlayerComponent,
                    ],
                    schemas: [CUSTOM_ELEMENTS_SCHEMA],
                },
            })
            .compileComponents();
        fixture = TestBed.createComponent(WebPlayerViewComponent);
        fixture.componentRef.setInput(
            'playbackSessionKey',
            'synthetic-session'
        );
        fixture.componentRef.setInput('playback', playback);
        fixture.componentRef.setInput('streamUrl', playback.streamUrl);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture?.destroy();
        Reflect.deleteProperty(window, 'TvShell');
        Reflect.deleteProperty(window, 'iptvnatorAndroidPlaybackLabels');
    });

    it.each([false, true])(
        'allows the guide to retune after live Media3 exit, EOF=%s',
        (ended) => {
            const component = fixture.componentInstance;
            const started = jest.fn();
            component.playbackStarted.subscribe(started);
            const binding = component.activeBinding();
            if (!binding) throw new Error('Expected an active web player');
            component.handlePlaybackIssue(
                {
                    code: PlaybackDiagnosticCode.UnsupportedCodec,
                    source: PlaybackDiagnosticSource.Hls,
                    sourceUrl: playback.streamUrl,
                    player: 'videojs',
                    container: 'hls',
                    audioCodecs: ['ac-3'],
                    videoCodecs: ['avc1.640028'],
                },
                binding
            );

            fixture.nativeElement
                .querySelector('[data-tv-native-playback]')
                .click();
            fixture.detectChanges();
            const [, id] = JSON.parse(postMessage.mock.lastCall?.[0] as string);
            expect(component.androidPlayback.suspended()).toBe(true);
            window.dispatchEvent(
                new CustomEvent('iptvnator:android-playback-result', {
                    detail: {
                        id,
                        result: {
                            positionMs: 0,
                            durationMs: 0,
                            playedMs: 2000,
                            started: true,
                            ended,
                        },
                    },
                })
            );

            expect(started).not.toHaveBeenCalled();
            expect(component.hasStartedPlayback()).toBe(false);
            expect(component.retryFailedPlayback()).toBe(true);
            expect(component.androidPlayback.suspended()).toBe(false);
        }
    );
});
