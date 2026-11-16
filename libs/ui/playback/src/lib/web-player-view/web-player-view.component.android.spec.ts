import {
    ComponentFixture,
    TestBed,
    DeferBlockBehavior,
} from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { StorageMap } from '@ngx-pwa/local-storage';
import { firstValueFrom, of } from 'rxjs';
import {
    TranslateModule,
    TranslatePipe,
    TranslateService,
} from '@ngx-translate/core';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { PLAYBACK_ACTIVITY_EVENTS } from '@iptvnator/services/activity-events';
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
    let beginActivity: jest.Mock<Promise<void>>;
    const playback = {
        streamUrl: 'https://media.example.test/synthetic-channel.m3u8',
        title: 'Synthetic channel',
        isLive: true,
    };

    beforeEach(async () => {
        postMessage = jest.fn();
        beginActivity = jest.fn().mockResolvedValue(undefined);
        Object.assign(window, {
            TvShell: { postMessage },
            iptvnatorAndroidPlaybackEnabled: true,
        });
        const { WebPlayerViewComponent } =
            await import('./web-player-view.component');
        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: PLAYBACK_ACTIVITY_EVENTS,
                    useValue: { begin: beginActivity, active: () => true },
                },
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
                        TranslatePipe,
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
        Reflect.deleteProperty(window, 'iptvnatorAndroidPlaybackEnabled');
    });

    it('updates the native player action when the app language changes', async () => {
        const translate = TestBed.inject(TranslateService);
        const open = () =>
            fixture.nativeElement.querySelector('[data-tv-native-playback]')
                .textContent;
        translate.setTranslation('en', {
            PLAYBACK_DIAGNOSTICS: {
                ACTION_TRY_BUILT_IN_PLAYER: 'Try built-in player',
            },
        });
        translate.setTranslation('fr', {
            PLAYBACK_DIAGNOSTICS: {
                ACTION_TRY_BUILT_IN_PLAYER: 'Essayer le lecteur intégré',
            },
        });
        await firstValueFrom(translate.use('en'));
        fixture.detectChanges();
        expect(open()).toContain('Try built-in player');
        await firstValueFrom(translate.use('fr'));
        fixture.detectChanges();
        expect(open()).toContain('Essayer le lecteur intégré');
    });

    it('keeps the playback attempt when Media3 is enabled from settings', () => {
        function setEnabled(enabled: boolean): void {
            Object.assign(window, { iptvnatorAndroidPlaybackEnabled: enabled });
            window.dispatchEvent(
                new Event('iptvnator:android-playback-availability')
            );
            fixture.detectChanges();
        }
        const host = fixture.nativeElement as HTMLElement;
        setEnabled(false);
        const attempt = host.getAttribute('data-tv-playback-attempt');
        expect(attempt).toBeTruthy();
        expect(host.querySelector('[data-tv-native-playback]')).toBeNull();

        setEnabled(true);
        expect(
            host
                .querySelector('[data-tv-native-playback]')
                ?.getAttribute('data-tv-native-playback')
        ).toBe(attempt);
    });

    it.each(['ready', 'cancelled', 'destroyed', 'failed'] as const)(
        'waits for a durable VOD session before opening Media3 (%s)',
        async (outcome) => {
            let finishBegin!: () => void;
            let failBegin!: (error: Error) => void;
            beginActivity.mockReturnValue(
                new Promise<void>((resolve, reject) => {
                    finishBegin = resolve;
                    failBegin = reject;
                })
            );
            fixture.componentRef.setInput('playback', {
                ...playback,
                isLive: false,
                contentInfo: {
                    playlistId: 'synthetic-source',
                    contentType: 'vod',
                    contentXtreamId: 17,
                    activitySessionId: 'synthetic-activity',
                },
            });
            fixture.detectChanges();
            expect(beginActivity).toHaveBeenCalledTimes(1);

            fixture.nativeElement
                .querySelector('[data-tv-native-playback]')
                .click();
            fixture.detectChanges();
            expect(postMessage).not.toHaveBeenCalled();

            const native = fixture.componentInstance.androidPlayback;
            if (outcome === 'cancelled') {
                const actions = (
                    fixture.nativeElement as HTMLElement
                ).querySelector('.web-player-android-actions');
                const returnToWeb = actions?.querySelector<HTMLButtonElement>(
                    'button:not([data-tv-native-playback])'
                );
                expect(returnToWeb).toBeTruthy();
                returnToWeb?.click();
            }
            if (outcome === 'destroyed') fixture.destroy();
            if (outcome === 'failed') failBegin(new Error('Synthetic failure'));
            else finishBegin();
            await fixture.whenStable();

            const playRequests = postMessage.mock.calls
                .map(([message]) => JSON.parse(message))
                .filter(([command]) => command === 'playNative');
            if (outcome === 'ready') {
                expect(playRequests).toHaveLength(1);
                expect(playRequests[0][2]).toMatchObject({
                    checkpoint: { activitySessionId: 'synthetic-activity' },
                });
            } else {
                expect(playRequests).toEqual([]);
                expect(native.suspended()).toBe(false);
            }
        }
    );

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
