import {
    ComponentFixture,
    TestBed,
    DeferBlockBehavior,
} from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { OverlayContainer } from '@angular/cdk/overlay';
import { PlaybackDiagnosticPanelComponent } from '../playback-diagnostic-panel/playback-diagnostic-panel.component';
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

describe('Android TV playback handoff and recovery', () => {
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
                        MatMenuModule,
                        PlaybackDiagnosticPanelComponent,
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
            TestBed.inject(OverlayContainer)
                .getContainerElement()
                .querySelector('[data-tv-native-playback]')?.textContent;
        translate.setTranslation('en', {
            PLAYBACK_DIAGNOSTICS: {
                ACTION_OPEN_BUILT_IN_PLAYER: 'Open in built-in player',
            },
        });
        translate.setTranslation('fr', {
            PLAYBACK_DIAGNOSTICS: {
                ACTION_OPEN_BUILT_IN_PLAYER: 'Ouvrir dans le lecteur intégré',
            },
        });
        await firstValueFrom(translate.use('en'));
        fixture.detectChanges();
        fixture.nativeElement.querySelector('[data-tv-player-menu]').click();
        fixture.detectChanges();
        expect(open()).toContain('Open in built-in player');
        await firstValueFrom(translate.use('fr'));
        fixture.detectChanges();
        expect(open()).toContain('Ouvrir dans le lecteur intégré');
    });

    const action = (key: string) =>
        (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
            `[data-tv-recovery-action="${key}"]`
        );
    const primary = () =>
        (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
            '[data-tv-recovery-primary]'
        );
    function report(code: PlaybackDiagnosticCode): void {
        const component = fixture.componentInstance;
        const binding = component.activeBinding();
        if (!binding) throw new Error('Expected an active web player');
        component.handlePlaybackIssue(
            {
                code,
                source: PlaybackDiagnosticSource.Hls,
                sourceUrl: component.resolvedPlayback().streamUrl,
                player: 'videojs',
                container: 'hls',
                audioCodecs: [],
                videoCodecs: [],
            },
            binding
        );
        fixture.detectChanges();
    }
    function replyToExternalCheck(available: boolean, id?: string): void {
        const request = postMessage.mock.calls
            .map(([message]) => JSON.parse(message))
            .findLast(([command]) => command === 'checkExternalPlayback');
        window.dispatchEvent(
            new CustomEvent('iptvnator:android-external-playback', {
                detail: { id: id ?? request?.[1], available },
            })
        );
        fixture.detectChanges();
    }

    it('checks the external player from a plain HTTP host', () => {
        const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
        Object.defineProperty(crypto, 'randomUUID', {
            configurable: true,
            value: undefined,
        });
        try {
            report(PlaybackDiagnosticCode.UnsupportedCodec);
            expect(JSON.parse(postMessage.mock.lastCall?.[0] as string)).toEqual([
                'checkExternalPlayback',
                expect.stringMatching(/^[a-f0-9-]{36}$/),
                playback.streamUrl,
            ]);
            replyToExternalCheck(true);
            expect(action('external')).not.toBeNull();
        } finally {
            if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
            else Reflect.deleteProperty(crypto, 'randomUUID');
        }
    });

    it('shows one panel with Media3 focused and a directly available chooser', () => {
        expect(postMessage).not.toHaveBeenCalled();
        report(PlaybackDiagnosticCode.UnsupportedCodec);
        replyToExternalCheck(true);
        expect(primary()).toBe(action('builtIn'));
        expect(document.activeElement).toBe(primary());
        expect(
            fixture.nativeElement.querySelector('[data-tv-player-menu]')
        ).toBeNull();
        expect(fixture.nativeElement.querySelector('details')?.open).toBe(
            false
        );

        action('external')?.click();
        expect(JSON.parse(postMessage.mock.lastCall?.[0] as string)).toEqual([
            'chooseExternalPlayback',
            playback.streamUrl,
            playback.title,
        ]);

        action('builtIn')?.click();
        fixture.detectChanges();
        const [, id] = JSON.parse(postMessage.mock.lastCall?.[0] as string);
        window.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-result', {
                detail: {
                    id,
                    result: { failed: true, positionMs: 0, durationMs: 0 },
                },
            })
        );
        fixture.detectChanges();
        expect(primary()).toBe(action('external'));
        expect(document.activeElement).toBe(primary());
        expect(action('builtIn')).toBeNull();
    });

    it('keeps web recovery after Media3 plays part of a VOD item', () => {
        fixture.componentRef.setInput('playback', {
            ...playback,
            isLive: false,
        });
        fixture.detectChanges();
        report(PlaybackDiagnosticCode.UnsupportedCodec);
        replyToExternalCheck(true);
        action('builtIn')?.click();
        fixture.detectChanges();
        const [, id] = JSON.parse(postMessage.mock.lastCall?.[0] as string);

        window.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-result', {
                detail: {
                    id,
                    result: {
                        started: true,
                        playedMs: 2000,
                        positionMs: 6000,
                        durationMs: 20000,
                    },
                },
            })
        );
        fixture.detectChanges();

        expect(action('external')).toBeTruthy();
        expect(action('return')).toBeTruthy();
        expect(fixture.componentInstance.effectiveStartTime()).toBe(6);
    });

    it('keeps the manual menu trigger focused during the Media3 handoff', () => {
        const host = fixture.nativeElement as HTMLElement;
        const trigger = host.querySelector<HTMLButtonElement>(
            '[data-tv-player-menu]'
        )!;
        const menu = TestBed.inject(OverlayContainer).getContainerElement();
        trigger.focus();
        trigger.click();
        fixture.detectChanges();
        menu.querySelector<HTMLButtonElement>(
            '[data-tv-native-playback]'
        )!.click();
        fixture.detectChanges();
        const [, id] = JSON.parse(postMessage.mock.lastCall?.[0] as string);
        expect(host.querySelector('[data-tv-player-menu]')).toBe(trigger);
        expect(trigger.getAttribute('aria-disabled')).toBe('true');

        window.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-result', {
                detail: { id, result: { positionMs: 0, durationMs: 0 } },
            })
        );
        fixture.detectChanges();

        expect(trigger.getAttribute('aria-disabled')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('prioritizes reconnect on a network failure', () => {
        report(PlaybackDiagnosticCode.NetworkError);
        expect(primary()).toBe(action('reconnect'));
        expect(action('external')).toBeNull();
        expect(action('builtIn')).toBeTruthy();
    });

    it('ignores a stale external availability reply for a format error', () => {
        report(PlaybackDiagnosticCode.UnsupportedCodec);
        replyToExternalCheck(true, 'synthetic-stale-id');
        expect(action('external')).toBeNull();
        replyToExternalCheck(true);
        expect(action('external')).toBeTruthy();
    });

    it.each([
        ['an oversized title', playback.streamUrl, 256],
        [
            'a URL near the bridge limit',
            `${playback.streamUrl}?token=${'a'.repeat(65_400)}`,
            0,
        ],
    ] as const)(
        'opens the chooser with %s',
        (_case, streamUrl, titleLength) => {
            const title = 'Synthetic title '.repeat(5000);
            fixture.componentRef.setInput('streamUrl', streamUrl);
            fixture.componentRef.setInput('playback', {
                ...playback,
                streamUrl,
                title,
            });
            fixture.detectChanges();
            report(PlaybackDiagnosticCode.UnsupportedCodec);
            replyToExternalCheck(true);

            action('external')?.click();
            expect(JSON.parse(postMessage.mock.lastCall?.[0] as string)).toEqual([
                'chooseExternalPlayback',
                streamUrl,
                title.slice(0, titleLength),
            ]);
        }
    );

    it('can switch web engines when Media3 and the external chooser are unavailable', () => {
        Object.assign(window, { iptvnatorAndroidPlaybackEnabled: false });
        window.dispatchEvent(
            new Event('iptvnator:android-playback-availability')
        );
        report(PlaybackDiagnosticCode.MediaDecodeError);
        replyToExternalCheck(false);
        expect(primary()).toBe(action('retry'));
        expect(action('builtIn')).toBeNull();
        expect(action('external')).toBeNull();
        const host: HTMLElement = fixture.nativeElement;
        const engine = host.querySelector<HTMLButtonElement>(
            '[data-test-id="playback-recommendation-html5"]'
        );
        expect(engine).not.toBeNull();
        engine!.click();
        fixture.detectChanges();
        expect(fixture.componentInstance.selectedPlayer()).toBe(
            VideoPlayer.Html5Player
        );
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

            const component = fixture.componentInstance;
            component.androidPlayback.open(
                component.resolvedPlayback(),
                component.resolvedIsLive(),
                component.effectiveStartTime(),
                component.showCaptions(),
                component.fullscreenSurface
            );
            fixture.detectChanges();
            expect(
                postMessage.mock.calls.some(
                    ([message]) => JSON.parse(message)[0] === 'playNative'
                )
            ).toBe(false);

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

            fixture.detectChanges();
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
