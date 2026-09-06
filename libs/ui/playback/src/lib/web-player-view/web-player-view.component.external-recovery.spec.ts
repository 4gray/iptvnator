import { ClipboardModule } from '@angular/cdk/clipboard';
import { signal } from '@angular/core';
import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
    type PlaybackFallbackRequest,
} from '@iptvnator/playback/util';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    type ExternalPlayerSession,
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { VodSourceRowComponent } from '@iptvnator/ui/components';
import { of } from 'rxjs';
import { PlaybackDiagnosticPanelComponent } from '../playback-diagnostic-panel/playback-diagnostic-panel.component';
import { ElectronStreamHeadersService } from './electron-stream-headers.service';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';
import {
    StubArtPlayerComponent,
    StubEmbeddedMpvPlayerComponent,
    StubFullscreenChannelPanelComponent,
    StubHtmlVideoPlayerComponent,
    StubVjsPlayerComponent,
} from './web-player-view.spec-stubs';

jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

describe('WebPlayerViewComponent external recovery integration', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let component: WebPlayerViewComponentInstance;
    let activeSession: ReturnType<typeof signal<ExternalPlayerSession | null>>;
    let closeSession: jest.Mock<Promise<void>, [ExternalPlayerSession]>;

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    beforeEach(async () => {
        activeSession = signal<ExternalPlayerSession | null>(null);
        closeSession = jest.fn(async (session) => {
            activeSession.set({
                ...session,
                status: 'closed',
                canClose: false,
                updatedAt: '2026-08-08T10:00:02.000Z',
            });
        });
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
                    useValue: { supportsManagedExternalPlayers: true },
                },
                {
                    provide: ElectronStreamHeadersService,
                    useValue: {
                        apply: jest.fn(() => null),
                        clear: jest.fn(),
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        showCaptions: () => false,
                        webPlayerSharedControls: () => false,
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession,
                        visibleSession: activeSession,
                        dismissActiveSession: jest.fn(),
                        closeSession,
                    },
                },
            ],
        })
            .overrideComponent(WebPlayerViewComponent, {
                set: {
                    imports: [
                        ClipboardModule,
                        MatButtonModule,
                        MatIconModule,
                        MatTooltipModule,
                        PlaybackDiagnosticPanelComponent,
                        StubArtPlayerComponent,
                        StubEmbeddedMpvPlayerComponent,
                        StubFullscreenChannelPanelComponent,
                        StubHtmlVideoPlayerComponent,
                        StubVjsPlayerComponent,
                        TranslateModule,
                        VodSourceRowComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WebPlayerViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput(
            'streamUrl',
            'https://example.com/live.m3u8'
        );
        fixture.componentRef.setInput('title', 'Recovery stream');
        fixture.componentRef.setInput('playbackSessionKey', 'content-a');
    });

    afterEach(() => fixture.destroy());

    it('keeps both external actions mounted while MPV launches and after it starts', async () => {
        const requests: PlaybackFallbackRequest[] = [];
        component.externalFallbackRequested.subscribe((request) =>
            requests.push(request)
        );
        await showDiagnostic();
        const mpvButton = requiredButton('playback-fallback-mpv');
        const vlcButton = requiredButton('playback-fallback-vlc');

        mpvButton.click();
        mpvButton.click();
        fixture.detectChanges();

        expect(requests).toHaveLength(1);
        expect(component.externalRecoveryPending()).toBe(true);
        expect(component.externalRecoveryState().mpv).toEqual({
            attempts: 1,
            sessionId: null,
            status: 'launching',
        });
        expect(requiredButton('playback-fallback-mpv')).toBe(mpvButton);
        expect(requiredButton('playback-fallback-vlc')).toBe(vlcButton);

        const opened = externalSession({ id: 'mpv-session', status: 'opened' });
        activeSession.set(opened);
        requests[0].trackLaunch(Promise.resolve(opened));
        await Promise.resolve();
        fixture.detectChanges();

        expect(component.externalRecoveryPending()).toBe(false);
        expect(component.externalRecoveryState().mpv).toEqual({
            attempts: 1,
            sessionId: 'mpv-session',
            status: 'started',
        });
        expect(playerActionIds()).toEqual([
            'playback-recommendation-html5',
            'playback-fallback-vlc',
            'playback-fallback-mpv',
        ]);
    });

    it('closes an active external player before emitting a different target', async () => {
        const requests: PlaybackFallbackRequest[] = [];
        component.externalFallbackRequested.subscribe((request) =>
            requests.push(request)
        );
        await showDiagnostic();
        click('playback-fallback-mpv');
        const opened = externalSession({ id: 'mpv-session', status: 'opened' });
        activeSession.set(opened);
        requests[0].trackLaunch(Promise.resolve(opened));
        await Promise.resolve();
        fixture.detectChanges();

        click('playback-fallback-vlc');
        await fixture.whenStable();

        expect(closeSession).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'mpv-session' })
        );
        expect(requests.map(({ player }) => player)).toEqual(['mpv', 'vlc']);
    });

    it('cancels the pending replacement when the diagnostic clears during close', async () => {
        const requests: PlaybackFallbackRequest[] = [];
        component.externalFallbackRequested.subscribe((request) =>
            requests.push(request)
        );
        await showDiagnostic();
        click('playback-fallback-mpv');
        const opened = externalSession({ id: 'mpv-session', status: 'opened' });
        activeSession.set(opened);
        requests[0].trackLaunch(Promise.resolve(opened));
        await Promise.resolve();
        fixture.detectChanges();
        let releaseClose: (() => void) | undefined;
        closeSession.mockImplementationOnce(
            (session) =>
                new Promise<void>((resolve) => {
                    releaseClose = () => {
                        activeSession.set({
                            ...session,
                            status: 'closed',
                            canClose: false,
                        });
                        resolve();
                    };
                })
        );

        click('playback-fallback-vlc');
        vjs().playbackIssue.emit(null);
        fixture.detectChanges();
        releaseClose?.();
        await fixture.whenStable();

        expect(requests.map(({ player }) => player)).toEqual(['mpv']);
        expect(component.externalRecoveryPending()).toBe(false);
        expect(component.externalRecoveryState().vlc).toEqual({
            attempts: 1,
            sessionId: null,
            status: 'idle',
        });
    });

    it('reports a local failure instead of launching beside an unclosable session', async () => {
        activeSession.set(
            externalSession({
                id: 'unclosable',
                player: 'vlc',
                canClose: false,
            })
        );
        const requests: unknown[] = [];
        component.externalFallbackRequested.subscribe((request) =>
            requests.push(request)
        );
        await showDiagnostic();

        click('playback-fallback-mpv');
        await fixture.whenStable();

        expect(requests).toEqual([]);
        expect(closeSession).not.toHaveBeenCalled();
        expect(component.externalRecoveryState().mpv.status).toBe('error');
        expect(playerActionIds()).toContain('playback-fallback-mpv');
    });

    it('rejects a stale external session after the content key changes', async () => {
        await showDiagnostic();
        click('playback-fallback-mpv');

        fixture.componentRef.setInput('playbackSessionKey', 'content-b');
        setPlayback({ streamUrl: 'https://example.com/next.m3u8' });
        fixture.detectChanges();
        activeSession.set(
            externalSession({ id: 'stale-mpv', status: 'error' })
        );
        fixture.detectChanges();

        expect(component.externalRecoveryState().mpv).toEqual({
            attempts: 0,
            sessionId: null,
            status: 'idle',
        });
    });

    it.each([
        { target: 'mpv' as const, testId: 'playback-fallback-mpv' },
        { target: 'vlc' as const, testId: 'playback-fallback-vlc' },
    ])(
        'emits one exact $target request for a same-tick double activation',
        async ({ target, testId }) => {
            const requests: PlaybackFallbackRequest[] = [];
            component.externalFallbackRequested.subscribe((request) =>
                requests.push(request)
            );
            const issue = await showDiagnostic();
            const button = requiredButton(testId);

            button.click();
            button.click();

            expect(requests).toEqual([
                {
                    player: target,
                    playback: component.resolvedPlayback(),
                    diagnostic: issue,
                    trackLaunch: expect.any(Function),
                },
            ]);
        }
    );

    it.each([
        { target: 'mpv' as const, testId: 'playback-fallback-mpv' },
        { target: 'vlc' as const, testId: 'playback-fallback-vlc' },
    ])(
        'rejects a stale $target activation after playback becomes DRM protected',
        async ({ testId }) => {
            const requests: unknown[] = [];
            component.externalFallbackRequested.subscribe((request) =>
                requests.push(request)
            );
            await showDiagnostic();
            const staleButton = requiredButton(testId);

            setPlayback({
                drm: {
                    licenseType: 'clearkey',
                    supported: true,
                    clearKeys: {
                        '00112233445566778899aabbccddeeff':
                            'ffeeddccbbaa99887766554433221100',
                    },
                },
            });
            staleButton.click();

            expect(requests).toEqual([]);
        }
    );

    async function showDiagnostic(): Promise<PlaybackDiagnostic> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const issue = mediaIssue();
        vjs().playbackIssue.emit(issue);
        fixture.detectChanges();
        return issue;
    }

    function setPlayback(overrides: Partial<ResolvedPortalPlayback>): void {
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/live.m3u8',
            title: 'Recovery stream',
            isLive: false,
            ...overrides,
        });
    }

    function vjs(): StubVjsPlayerComponent {
        return fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            .componentInstance as StubVjsPlayerComponent;
    }

    function click(testId: string): void {
        requiredButton(testId).click();
    }

    function requiredButton(testId: string): HTMLButtonElement {
        const button = fixture.nativeElement.querySelector(
            `[data-test-id="${testId}"]`
        );
        expect(button).toBeInstanceOf(HTMLButtonElement);
        if (!(button instanceof HTMLButtonElement)) {
            throw new Error(`Expected ${testId} button`);
        }
        return button;
    }

    function playerActionIds(): string[] {
        return Array.from(
            fixture.nativeElement.querySelectorAll(
                '.web-player-diagnostic__player-card'
            ) as NodeListOf<HTMLElement>
        ).map((element) => element.dataset['testId'] ?? '');
    }
});

function externalSession(
    overrides: Partial<ExternalPlayerSession> = {}
): ExternalPlayerSession {
    return {
        id: 'external-session',
        player: 'mpv',
        status: 'opened',
        title: 'Recovery stream',
        streamUrl: 'https://example.com/live.m3u8',
        startedAt: '2026-08-08T10:00:00.000Z',
        updatedAt: '2026-08-08T10:00:01.000Z',
        canClose: true,
        ...overrides,
    };
}

function mediaIssue(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.MediaDecodeError,
        source: PlaybackDiagnosticSource.Vhs,
        sourceUrl: 'https://example.com/live.m3u8',
        container: 'm3u8',
        mimeType: 'application/x-mpegURL',
        player: 'videojs',
        audioCodecs: [],
        videoCodecs: [],
    };
}
