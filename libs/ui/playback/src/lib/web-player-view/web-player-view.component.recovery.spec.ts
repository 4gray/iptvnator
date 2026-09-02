import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
    type PlaybackFallbackRequest,
} from '@iptvnator/playback/util';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    type ExternalPlayerSession,
    STORE_KEY,
    VideoPlayer,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import { VodSourceRowComponent } from '@iptvnator/ui/components';
import { of } from 'rxjs';
import { PlaybackDiagnosticPanelComponent } from '../playback-diagnostic-panel/playback-diagnostic-panel.component';
import {
    StubArtPlayerComponent,
    StubEmbeddedMpvPlayerComponent,
    StubFullscreenChannelPanelComponent,
    StubHtmlVideoPlayerComponent,
    StubVjsPlayerComponent,
} from './web-player-view.spec-stubs';
import { ElectronStreamHeadersService } from './electron-stream-headers.service';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';

jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

describe('WebPlayerViewComponent recovery integration', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let component: WebPlayerViewComponentInstance;
    const storedSettings = { player: VideoPlayer.VideoJs };
    const storage = {
        get: jest.fn((key: string) =>
            of(key === STORE_KEY.Settings ? storedSettings : undefined)
        ),
    };
    let runtime: { supportsManagedExternalPlayers: boolean };
    let activeExternalSession: ReturnType<
        typeof signal<ExternalPlayerSession | null>
    >;
    let closeExternalSession: jest.Mock<Promise<void>, [ExternalPlayerSession]>;
    let holdHeaderHandoff: boolean;
    let headerResolvers: Array<(stillCurrent: boolean) => void>;
    let headerRejectors: Array<(reason?: unknown) => void>;
    const streamHeaders = {
        apply: jest.fn(
            () =>
                (holdHeaderHandoff
                    ? new Promise<boolean>((resolve, reject) => {
                          headerResolvers.push(resolve);
                          headerRejectors.push(reject);
                      })
                    : null) as Promise<boolean> | null
        ),
        clear: jest.fn(),
    };

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    beforeEach(async () => {
        runtime = { supportsManagedExternalPlayers: true };
        activeExternalSession = signal<ExternalPlayerSession | null>(null);
        closeExternalSession = jest.fn(async (session) => {
            activeExternalSession.set({
                ...session,
                status: 'closed',
                canClose: false,
                updatedAt: '2026-08-08T10:00:02.000Z',
            });
        });
        holdHeaderHandoff = false;
        headerResolvers = [];
        headerRejectors = [];
        streamHeaders.apply.mockClear();
        streamHeaders.clear.mockClear();
        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                { provide: StorageMap, useValue: storage },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                {
                    provide: ElectronStreamHeadersService,
                    useValue: streamHeaders,
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
                        activeSession: activeExternalSession,
                        visibleSession: activeExternalSession,
                        dismissActiveSession: jest.fn(),
                        closeSession: closeExternalSession,
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

    it('ranks HTML5, MPV, then VLC for a fatal Video.js HLS media failure', async () => {
        await render();

        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();

        expect(playerActionIds()).toEqual([
            'playback-recommendation-html5',
            'playback-fallback-mpv',
            'playback-fallback-vlc',
        ]);
    });

    it('mounts HTML5 temporarily without changing the saved Video.js setting', async () => {
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();

        click('playback-recommendation-html5');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(
                By.directive(StubHtmlVideoPlayerComponent)
            )
        ).not.toBeNull();
        expect(
            fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
        ).toBeNull();
        expect(storedSettings.player).toBe(VideoPlayer.VideoJs);
    });

    it('excludes Video.js and HTML5 player actions after the switched target fails', async () => {
        await switchToHtml5();

        html5().playbackIssue.emit(mediaIssue('html5'));
        fixture.detectChanges();

        expect(playerActionIds()).toEqual([
            'playback-fallback-mpv',
            'playback-fallback-vlc',
        ]);
    });

    it('retries the active target with a reload while preserving attempts', async () => {
        const fallbackRequests: PlaybackFallbackRequest[] = [];
        component.externalFallbackRequested.subscribe((request) =>
            fallbackRequests.push(request)
        );
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();
        click('playback-fallback-mpv');
        expect(fallbackRequests).toHaveLength(1);
        const opened = externalSession({
            id: 'mpv-retry-session',
            status: 'opened',
        });
        activeExternalSession.set(opened);
        fallbackRequests[0].trackLaunch(Promise.resolve(opened));
        await Promise.resolve();
        fixture.detectChanges();
        vjs().playbackIssue.emit(networkIssue('videojs'));
        fixture.detectChanges();

        click('playback-retry');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(vjs().options()).toEqual(
            expect.objectContaining({ reloadToken: 1 })
        );
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();
        expect(playerActionIds()).toEqual([
            'playback-recommendation-html5',
            'playback-fallback-vlc',
            'playback-fallback-mpv',
        ]);
    });

    it('keeps desktop browser-access guidance and both actions after both attempts', async () => {
        const fallbackRequests: PlaybackFallbackRequest[] = [];
        component.externalFallbackRequested.subscribe((request) =>
            fallbackRequests.push(request)
        );
        await render();
        vjs().playbackIssue.emit(browserAccessIssue('videojs'));
        fixture.detectChanges();

        click('playback-fallback-mpv');
        const openedMpv = externalSession({
            id: 'mpv-browser-session',
            status: 'opened',
        });
        activeExternalSession.set(openedMpv);
        fallbackRequests[0].trackLaunch(Promise.resolve(openedMpv));
        await Promise.resolve();
        fixture.detectChanges();
        click('playback-fallback-vlc');
        await fixture.whenStable();
        const openedVlc = externalSession({
            id: 'vlc-browser-session',
            player: 'vlc',
            status: 'opened',
        });
        activeExternalSession.set(openedVlc);
        fallbackRequests[1].trackLaunch(Promise.resolve(openedVlc));
        await Promise.resolve();
        fixture.detectChanges();

        const banner = query('playback-diagnostic-banner');
        expect(banner?.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.NATIVE_FALLBACK_TITLE'
        );
        expect(banner?.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.DESCRIPTION'
        );
        expect(banner?.textContent).not.toContain(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.PWA_DESCRIPTION'
        );
        expect(playerActionIds()).toEqual([
            'playback-fallback-mpv',
            'playback-fallback-vlc',
        ]);
    });

    it('preserves attempts when the URL changes under the same content key', async () => {
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();
        click('playback-fallback-mpv');

        setPlayback({ streamUrl: 'https://example.com/alternate.m3u8' });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(query('playback-diagnostic-banner')).toBeNull();
        vjs().playbackIssue.emit(mediaIssue('videojs', 'alternate.m3u8'));
        fixture.detectChanges();

        expect(playerActionIds()).toEqual([
            'playback-recommendation-html5',
            'playback-fallback-vlc',
            'playback-fallback-mpv',
        ]);
    });

    it('clears attempts and the temporary override for a new content key', async () => {
        await switchToHtml5();

        fixture.componentRef.setInput('playbackSessionKey', 'content-b');
        setPlayback({ streamUrl: 'https://example.com/next.m3u8' });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
        ).not.toBeNull();
        vjs().playbackIssue.emit(mediaIssue('videojs', 'next.m3u8'));
        fixture.detectChanges();
        expect(playerActionIds()).toEqual([
            'playback-recommendation-html5',
            'playback-fallback-mpv',
            'playback-fallback-vlc',
        ]);
    });

    it('applies a new content once after clearing a temporary player override', async () => {
        await switchToHtml5();
        const oldIssue = mediaIssue('html5', 'live.m3u8');
        html5().playbackIssue.emit(oldIssue);
        fixture.detectChanges();
        expect(component.playbackDiagnostic()).toBe(oldIssue);
        holdHeaderHandoff = true;
        streamHeaders.apply.mockClear();

        fixture.componentRef.setInput('playbackSessionKey', 'content-b');
        setPlayback({ streamUrl: 'https://example.com/next.m3u8' });
        fixture.detectChanges();

        expect(streamHeaders.apply).toHaveBeenCalledTimes(1);
        expect(headerResolvers).toHaveLength(1);
        expect(component.activeBinding()?.target).toBe(
            InlinePlaybackPlayer.VideoJs
        );
        expect(component.playbackDiagnostic()).toBeNull();
        expect(component.visiblePlaybackDiagnostic()).toBeNull();

        headerResolvers[0](true);
        await fixture.whenStable();

        expect(streamHeaders.apply).toHaveBeenCalledTimes(1);
        expect(component.selectedPlayer()).toBe(VideoPlayer.VideoJs);
        expect(component.channel?.url).toBe('https://example.com/next.m3u8');
        expect(component.playbackDiagnostic()).toBeNull();
    });

    it('hands the latest finite VOD time to a switch and starts live at zero', async () => {
        setPlayback({
            streamUrl: 'https://example.com/movie.m3u8',
            isLive: false,
            startTime: 7,
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 9,
                contentType: 'vod',
            },
        });
        await render();
        vjs().timeUpdate.emit({ currentTime: 48, duration: 120 });
        vjs().timeUpdate.emit({ currentTime: Number.NaN, duration: 120 });
        vjs().playbackIssue.emit(mediaIssue('videojs', 'movie.m3u8'));
        fixture.detectChanges();
        click('playback-recommendation-html5');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(html5().startTime()).toBe(48);

        fixture.componentRef.setInput('playbackSessionKey', 'content-live');
        setPlayback({
            streamUrl: 'https://example.com/live-2.m3u8',
            isLive: true,
            startTime: 99,
        });
        fixture.detectChanges();
        vjs().timeUpdate.emit({ currentTime: 74, duration: 100 });
        vjs().playbackIssue.emit(mediaIssue('videojs', 'live-2.m3u8'));
        fixture.detectChanges();
        click('playback-recommendation-html5');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(html5().startTime()).toBe(0);
    });

    it('resets the VOD handoff for a new same-key source without clearing recovery history', async () => {
        const timeUpdates: Array<{
            currentTime: number;
            duration: number;
        }> = [];
        component.timeUpdate.subscribe((event) => timeUpdates.push(event));
        setPlayback({
            streamUrl: 'https://example.com/program-a.m3u8',
            isLive: false,
        });
        await render();
        vjs().timeUpdate.emit({ currentTime: 48, duration: 120 });
        vjs().playbackIssue.emit(mediaIssue('videojs', 'program-a.m3u8'));
        fixture.detectChanges();
        click('playback-recommendation-html5');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(html5().startTime()).toBe(48);
        const sourceAOwnership = captureTimeUpdateOwnership();

        setPlayback({
            streamUrl: 'https://example.com/program-b.m3u8',
            isLive: false,
        });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(html5().startTime()).toBe(0);
        timeUpdates.length = 0;
        deliverTimeUpdate({ currentTime: 79, duration: 120 }, sourceAOwnership);
        expect(timeUpdates).toEqual([]);
        component.retryPlayback();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(html5().startTime()).toBe(0);

        html5().playbackIssue.emit(mediaIssue('html5', 'program-b.m3u8'));
        fixture.detectChanges();
        expect(playerActionIds()).toEqual([
            'playback-fallback-mpv',
            'playback-fallback-vlc',
        ]);
    });

    it('rejects a late Embedded MPV VOD time update after a same-key VOD source replaces it', async () => {
        const timeUpdates: Array<{
            currentTime: number;
            duration: number;
        }> = [];
        component.timeUpdate.subscribe((event) => timeUpdates.push(event));
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.EmbeddedMpv
        );
        setPlayback({
            streamUrl: 'https://example.com/vod-program-a.m3u8',
            isLive: false,
        });
        await render();
        const sourceAOwnership = captureTimeUpdateOwnership();

        setPlayback({
            streamUrl: 'https://example.com/vod-program-b.m3u8',
            isLive: false,
        });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        deliverTimeUpdate({ currentTime: 91, duration: 120 }, sourceAOwnership);
        expect(timeUpdates).toEqual([]);

        fixture.componentRef.setInput('playerOverride', VideoPlayer.VideoJs);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(vjs().startTime()).toBe(0);
    });

    it('emits and records a time update owned by the current application', async () => {
        const timeUpdates: Array<{
            currentTime: number;
            duration: number;
        }> = [];
        component.timeUpdate.subscribe((event) => timeUpdates.push(event));
        setPlayback({
            streamUrl: 'https://example.com/current-movie.m3u8',
            isLive: false,
        });
        await render();
        const event = { currentTime: 37, duration: 120 };

        vjs().timeUpdate.emit(event);

        expect(timeUpdates).toEqual([event]);
        component.retryPlayback();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(vjs().startTime()).toBe(37);
    });

    it('preserves the latest VOD position across a same-source retry', async () => {
        setPlayback({
            streamUrl: 'https://example.com/retry-movie.m3u8',
            isLive: false,
        });
        await render();
        vjs().timeUpdate.emit({ currentTime: 63, duration: 120 });
        vjs().playbackIssue.emit(networkIssue('videojs'));
        fixture.detectChanges();

        click('playback-retry');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(vjs().startTime()).toBe(63);
    });

    it('ignores actual outputs from the destroyed target generation after switching players', async () => {
        const failures: PlaybackDiagnosticCode[] = [];
        component.playbackFailed.subscribe((code) => failures.push(code));
        await render();
        const staleVjs = vjs();
        staleVjs.playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();
        click('playback-recommendation-html5');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(query('playback-diagnostic-banner')).toBeNull();

        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
            // Expected when probing an output owned by a destroyed stub.
        });
        staleVjs.playbackIssue.emit(mediaIssue('videojs', 'stale.m3u8'));
        fixture.detectChanges();
        expect(query('playback-diagnostic-banner')).toBeNull();

        html5().playbackIssue.emit(mediaIssue('html5'));
        fixture.detectChanges();
        expect(component.playbackDiagnostic()?.player).toBe('html5');

        staleVjs.playbackIssue.emit(null);
        fixture.detectChanges();
        expect(component.playbackDiagnostic()?.player).toBe('html5');
        expect(failures).toEqual([
            PlaybackDiagnosticCode.MediaDecodeError,
            PlaybackDiagnosticCode.MediaDecodeError,
        ]);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Unexpected emit for destroyed')
        );
        warn.mockRestore();
    });

    it('recreates a same-target generation and ignores old diagnostic and clear outputs', async () => {
        const failures: PlaybackDiagnosticCode[] = [];
        component.playbackFailed.subscribe((code) => failures.push(code));
        await render();
        const staleVjs = vjs();
        staleVjs.playbackIssue.emit(networkIssue('videojs'));
        fixture.detectChanges();

        click('playback-retry');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const currentVjs = vjs();
        expect(currentVjs).not.toBe(staleVjs);
        expect(query('playback-diagnostic-banner')).toBeNull();

        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
            // Expected when probing an output owned by a destroyed stub.
        });
        staleVjs.playbackIssue.emit(mediaIssue('videojs', 'stale.m3u8'));
        fixture.detectChanges();
        expect(query('playback-diagnostic-banner')).toBeNull();

        currentVjs.playbackIssue.emit(mediaIssue('videojs', 'current.m3u8'));
        fixture.detectChanges();
        expect(component.playbackDiagnostic()?.sourceUrl).toContain(
            'current.m3u8'
        );

        staleVjs.playbackIssue.emit(null);
        fixture.detectChanges();
        expect(component.playbackDiagnostic()?.sourceUrl).toContain(
            'current.m3u8'
        );
        expect(failures).toEqual([
            PlaybackDiagnosticCode.NetworkError,
            PlaybackDiagnosticCode.MediaDecodeError,
        ]);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Unexpected emit for destroyed')
        );
        warn.mockRestore();
    });

    it('rejects old player outputs when playback changes before the application effect runs', async () => {
        const failures: PlaybackDiagnosticCode[] = [];
        component.playbackFailed.subscribe((code) => failures.push(code));
        await render();
        component.retryPlayback();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const sourceAPlayer = vjs();
        expect(component.recoveryPending()).toBe(true);

        setPlayback({ streamUrl: 'https://example.com/source-b.m3u8' });
        sourceAPlayer.playbackIssue.emit(
            mediaIssue('videojs', 'source-a.m3u8')
        );
        sourceAPlayer.playbackIssue.emit(null);

        expect(component.playbackDiagnostic()).toBeNull();
        expect(component.recoveryPending()).toBe(true);
        expect(component.activeBinding()).toBeNull();
        expect(failures).toEqual([]);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const sourceBPlayer = vjs();
        expect(sourceBPlayer).not.toBe(sourceAPlayer);
        sourceBPlayer.playbackIssue.emit(
            mediaIssue('videojs', 'source-b.m3u8')
        );
        fixture.detectChanges();

        expect(component.playbackDiagnostic()?.sourceUrl).toBe(
            'https://example.com/source-b.m3u8'
        );
        expect(component.recoveryPending()).toBe(false);
        expect(failures).toEqual([PlaybackDiagnosticCode.MediaDecodeError]);
    });

    it('keeps the active recovery binding exact and credential-free', async () => {
        const sentinels = [
            'credential-stream.example/private.m3u8',
            'sentinel-cookie=secret',
            'Bearer sentinel-authorization',
            'SentinelAgent/7.0',
            'https://sentinel-referer.example',
            'https://sentinel-origin.example',
            'sentinel-clear-key-id',
            'sentinel-clear-key-value',
            'Sentinel private title',
        ];
        setPlayback({
            streamUrl: `https://${sentinels[0]}`,
            title: sentinels[8],
            headers: {
                Cookie: sentinels[1],
                Authorization: sentinels[2],
            },
            userAgent: sentinels[3],
            referer: sentinels[4],
            origin: sentinels[5],
            drm: {
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { [sentinels[6]]: sentinels[7] },
            },
        });
        await render();

        const binding = component.activeBinding();
        expect(binding).toEqual({
            generation: expect.any(Number),
            target: InlinePlaybackPlayer.VideoJs,
        });
        expect(Object.keys(binding ?? {})).toEqual(['generation', 'target']);
        const inspected = JSON.stringify(binding);
        for (const sentinel of sentinels) {
            expect(inspected).not.toContain(sentinel);
        }
    });

    it('exposes fieldless opaque application tokens without source material', async () => {
        const sentinels = [
            'opaque-stream.example/private.m3u8',
            'OpaqueAgent/4.0',
            'opaque-cookie=secret',
            'opaque-clear-key-value',
        ];
        setPlayback({
            streamUrl: `https://${sentinels[0]}`,
            headers: { Cookie: sentinels[2] },
            userAgent: sentinels[1],
            drm: {
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { key: sentinels[3] },
            },
        });
        await render();

        const tokens = component as unknown as {
            readonly playbackApplicationToken?: () => unknown;
            readonly playbackSourceRevisionToken?: () => unknown;
        };
        const applicationToken = tokens.playbackApplicationToken?.();
        const sourceRevisionToken = tokens.playbackSourceRevisionToken?.();
        const ownership = captureTimeUpdateOwnership();
        expect(applicationToken).toBeDefined();
        expect(sourceRevisionToken).toBeDefined();
        expect(typeof applicationToken).toBe('symbol');
        expect(typeof sourceRevisionToken).toBe('symbol');
        expect(Reflect.ownKeys(Object(applicationToken))).toEqual([]);
        expect(Reflect.ownKeys(Object(sourceRevisionToken))).toEqual([]);
        expect(Object.isFrozen(ownership)).toBe(true);
        expect(Object.keys(ownership)).toEqual([
            'binding',
            'embeddedMpv',
            'isLive',
            'sourceRevision',
            'token',
        ]);
        const inspected = `${String(applicationToken)} ${String(sourceRevisionToken)} ${JSON.stringify({ applicationToken, sourceRevisionToken, ownership })}`;
        for (const sentinel of sentinels) {
            expect(inspected).not.toContain(sentinel);
        }
    });

    it('keeps fallback ownership across title and time updates', async () => {
        await render();
        const binding = component.activeBinding();
        const player = vjs();

        fixture.componentRef.setInput('title', 'Updated display title');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(component.activeBinding()).toBe(binding);
        expect(vjs()).toBe(player);

        player.timeUpdate.emit({ currentTime: 31, duration: 90 });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(component.activeBinding()).toBe(binding);
        expect(vjs()).toBe(player);
    });

    it('rebinds for source, headers, DRM, live mode, target, and reload changes', async () => {
        await render();
        await expectBindingChange(() =>
            fixture.componentRef.setInput(
                'streamUrl',
                'https://example.com/relevant-url.m3u8'
            )
        );
        await expectBindingChange(() =>
            fixture.componentRef.setInput('startTime', 14)
        );

        let playback: Partial<ResolvedPortalPlayback> = {
            streamUrl: 'https://example.com/explicit.m3u8',
            isLive: false,
            headers: { Authorization: 'Bearer first' },
            drm: {
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { first: 'key-one' },
            },
        };
        await expectBindingChange(() => setPlayback(playback));
        playback = {
            ...playback,
            headers: { Authorization: 'Bearer second' },
        };
        await expectBindingChange(() => setPlayback(playback));
        playback = {
            ...playback,
            drm: {
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { second: 'key-two' },
            },
        };
        await expectBindingChange(() => setPlayback(playback));
        playback = { ...playback, isLive: true };
        await expectBindingChange(() => setPlayback(playback));
        await expectBindingChange(() =>
            fixture.componentRef.setInput(
                'playerOverride',
                VideoPlayer.ArtPlayer
            )
        );
        await expectBindingChange(() => component.retryPlayback());
    });

    it('never ranks MPV or VLC for DRM playback', async () => {
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
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();

        expect(playerActionIds()).toEqual(['playback-recommendation-html5']);
    });

    it('does not render managed external actions in the PWA runtime', async () => {
        runtime.supportsManagedExternalPlayers = false;
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();

        expect(playerActionIds()).toEqual(['playback-recommendation-html5']);
    });

    it('detaches the diagnostic while a player switch handoff is pending', async () => {
        const fallbackRequests: unknown[] = [];
        component.externalFallbackRequested.subscribe((request) =>
            fallbackRequests.push(request)
        );
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();
        holdHeaderHandoff = true;
        const htmlButton = requiredButton('playback-recommendation-html5');
        const staleMpvButton = requiredButton('playback-fallback-mpv');

        htmlButton.click();
        fixture.detectChanges();
        expect(query('playback-diagnostic-banner')).toBeNull();
        expect(component.visiblePlaybackDiagnostic()).toBeNull();
        staleMpvButton.click();
        expect(fallbackRequests).toEqual([]);

        expect(headerResolvers).toHaveLength(1);
        headerResolvers[0](true);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(html5().channel()).toEqual(
            expect.objectContaining({
                url: 'https://example.com/live.m3u8',
            })
        );
        expect(query('playback-diagnostic-banner')).toBeNull();
    });

    it.each([
        ['source', 'false'],
        ['source', 'rejection'],
        ['player', 'false'],
        ['player', 'rejection'],
        ['reload', 'false'],
        ['reload', 'rejection'],
    ] as const)(
        'clears the backing diagnostic for a $intent intent whose handoff ends in $outcome',
        async (intent, outcome) => {
            await render();
            const oldIssue = mediaIssue('videojs');
            vjs().playbackIssue.emit(oldIssue);
            fixture.detectChanges();
            expect(component.playbackDiagnostic()).toBe(oldIssue);
            holdHeaderHandoff = true;

            if (intent === 'source') {
                setPlayback({
                    streamUrl: 'https://example.com/replacement.m3u8',
                });
            } else if (intent === 'player') {
                click('playback-recommendation-html5');
            } else {
                component.retryPlayback();
            }
            fixture.detectChanges();
            expect(headerResolvers).toHaveLength(1);
            expect(component.recoveryPending()).toBe(intent !== 'source');
            expect(component.playbackDiagnostic()).toBeNull();
            expect(component.visiblePlaybackDiagnostic()).toBeNull();
            expect(query('playback-diagnostic-banner')).toBeNull();

            if (outcome === 'false') {
                headerResolvers[0](false);
            } else {
                headerRejectors[0](new Error('header IPC failed'));
            }
            await fixture.whenStable();
            fixture.detectChanges();

            expect(component.recoveryPending()).toBe(false);
            expect(component.playbackDiagnostic()).toBeNull();
            expect(component.visiblePlaybackDiagnostic()).toBeNull();
            expect(query('playback-diagnostic-banner')).toBeNull();
            expect(component.channel).toBeUndefined();
        }
    );

    it.each(['success', 'false', 'rejection'] as const)(
        'preserves the exact newer diagnostic after a stale handoff $outcome',
        async (outcome) => {
            await render();
            holdHeaderHandoff = true;
            setPlayback({ streamUrl: 'https://example.com/stale.m3u8' });
            fixture.detectChanges();
            expect(headerResolvers).toHaveLength(1);

            holdHeaderHandoff = false;
            setPlayback({ streamUrl: 'https://example.com/current.m3u8' });
            fixture.detectChanges();
            const currentBinding = component.activeBinding();
            const currentIssue = mediaIssue('videojs', 'current.m3u8');
            vjs().playbackIssue.emit(currentIssue);
            fixture.detectChanges();
            expect(component.playbackDiagnostic()).toBe(currentIssue);
            expect(component.visiblePlaybackDiagnostic()).toBe(currentIssue);

            if (outcome === 'success') {
                headerResolvers[0](true);
            } else if (outcome === 'false') {
                headerResolvers[0](false);
            } else {
                headerRejectors[0](new Error('stale header IPC failed'));
            }
            await fixture.whenStable();

            expect(component.activeBinding()).toBe(currentBinding);
            expect(component.playbackDiagnostic()).toBe(currentIssue);
            expect(component.visiblePlaybackDiagnostic()).toBe(currentIssue);
            expect(component.channel?.url).toBe(
                'https://example.com/current.m3u8'
            );
        }
    );

    it.each([
        {
            outcome: 'false',
            completeStale: () => headerResolvers[0](false),
        },
        {
            outcome: 'rejection',
            completeStale: () =>
                headerRejectors[0](new Error('stale header IPC failed')),
        },
    ])(
        'does not settle the current handoff when a stale one completes with $outcome',
        async ({ completeStale }) => {
            await render();
            vjs().playbackIssue.emit(mediaIssue('videojs'));
            fixture.detectChanges();
            holdHeaderHandoff = true;
            click('playback-recommendation-html5');
            fixture.detectChanges();

            setPlayback({ streamUrl: 'https://example.com/current.m3u8' });
            fixture.detectChanges();
            expect(headerResolvers).toHaveLength(2);

            completeStale();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(component.recoveryPending()).toBe(true);
            expect(component.visiblePlaybackDiagnostic()).toBeNull();
            expect(component.channel).toBeUndefined();

            headerResolvers[1](false);
            await fixture.whenStable();
        }
    );

    it('rejects a pending header success for a newer pre-effect source intent', async () => {
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();
        const failures: PlaybackDiagnosticCode[] = [];
        component.playbackFailed.subscribe((code) => failures.push(code));
        holdHeaderHandoff = true;

        setPlayback({ streamUrl: 'https://example.com/source-a.m3u8' });
        fixture.detectChanges();
        const sourceABinding = component.activeBinding();
        expect(sourceABinding).not.toBeNull();
        expect(headerResolvers).toHaveLength(1);
        expect(component.channel).toBeUndefined();
        expect(component.visiblePlaybackDiagnostic()).toBeNull();

        setPlayback({ streamUrl: 'https://example.com/source-b.m3u8' });
        const pendingState = {
            binding: component.activeBinding(),
            pending: component.recoveryPending(),
            diagnostic: component.playbackDiagnostic(),
            channel: component.channel,
            vjsOptions: component.vjsOptions,
            failures: [...failures],
        };

        headerResolvers[0](true);
        await Promise.resolve();

        expect({
            binding: component.activeBinding(),
            pending: component.recoveryPending(),
            diagnostic: component.playbackDiagnostic(),
            channel: component.channel,
            vjsOptions: component.vjsOptions,
            failures,
        }).toEqual(pendingState);
        expect(component.visiblePlaybackDiagnostic()).toBeNull();
        expect(streamHeaders.apply).toHaveBeenCalledTimes(2);

        fixture.detectChanges();
        expect(headerResolvers).toHaveLength(2);
        expect(component.activeBinding()).not.toBe(sourceABinding);
        headerResolvers[1](true);
        await fixture.whenStable();

        expect(component.channel?.url).toBe(
            'https://example.com/source-b.m3u8'
        );
        expect(component.vjsOptions?.sources).toEqual([
            expect.objectContaining({
                src: 'https://example.com/source-b.m3u8',
            }),
        ]);
        expect(component.playbackDiagnostic()).toBeNull();
        expect(failures).toEqual([]);
    });

    it.each([
        {
            outcome: 'success',
            complete: () => headerResolvers[0](true),
        },
        {
            outcome: 'false',
            complete: () => headerResolvers[0](false),
        },
        {
            outcome: 'rejection',
            complete: () =>
                headerRejectors[0](new Error('destroyed header IPC failed')),
        },
    ])(
        'invalidates a pending handoff before destruction and ignores its $outcome',
        async ({ complete }) => {
            await render();
            vjs().playbackIssue.emit(mediaIssue('videojs'));
            fixture.detectChanges();
            holdHeaderHandoff = true;
            click('playback-recommendation-html5');
            fixture.detectChanges();
            const diagnostic = component.playbackDiagnostic();
            const failures: PlaybackDiagnosticCode[] = [];
            component.playbackFailed.subscribe((code) => failures.push(code));

            expect(component.activeBinding()).not.toBeNull();
            expect(component.recoveryPending()).toBe(true);
            expect(component.channel).toBeUndefined();
            fixture.destroy();

            expect(component.activeBinding()).toBeNull();
            expect(component.recoveryPending()).toBe(false);
            const destroyedState = {
                binding: component.activeBinding(),
                pending: component.recoveryPending(),
                diagnostic: component.playbackDiagnostic(),
                channel: component.channel,
                vjsOptions: component.vjsOptions,
                failures: [...failures],
            };

            complete();
            await Promise.resolve();

            expect({
                binding: component.activeBinding(),
                pending: component.recoveryPending(),
                diagnostic: component.playbackDiagnostic(),
                channel: component.channel,
                vjsOptions: component.vjsOptions,
                failures,
            }).toEqual(destroyedState);
            expect(component.playbackDiagnostic()).toBe(diagnostic);
        }
    );

    it('releases web headers and diagnostics across a same-instance Embedded MPV transition', async () => {
        setPlayback({ streamUrl: 'https://example.com/source-a.m3u8' });
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs', 'source-a.m3u8'));
        fixture.detectChanges();
        expect(component.playbackDiagnostic()).not.toBeNull();

        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.EmbeddedMpv
        );
        fixture.detectChanges();

        expect(streamHeaders.clear).toHaveBeenCalledWith(
            'https://example.com/source-a.m3u8'
        );
        expect(component.activeBinding()).toBeNull();
        expect(component.playbackDiagnostic()).toBeNull();

        setPlayback({ streamUrl: 'https://example.com/source-b.m3u8' });
        fixture.componentRef.setInput('playerOverride', VideoPlayer.VideoJs);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(streamHeaders.apply).toHaveBeenLastCalledWith(
            expect.objectContaining({
                streamUrl: 'https://example.com/source-b.m3u8',
            })
        );
        expect(vjs().options()).toEqual(
            expect.objectContaining({
                sources: [
                    expect.objectContaining({
                        src: 'https://example.com/source-b.m3u8',
                    }),
                ],
            })
        );
        expect(component.playbackDiagnostic()).toBeNull();
        vjs().playbackIssue.emit(mediaIssue('videojs', 'source-b.m3u8'));
        fixture.detectChanges();
        expect(component.playbackDiagnostic()?.sourceUrl).toBe(
            'https://example.com/source-b.m3u8'
        );
    });

    it('keeps a replaced-source diagnostic detached across every handoff outcome', async () => {
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();
        holdHeaderHandoff = true;

        setPlayback({ streamUrl: 'https://example.com/alternate.m3u8' });
        fixture.detectChanges();
        expect(query('playback-diagnostic-banner')).toBeNull();
        setPlayback({ streamUrl: 'https://example.com/current.m3u8' });
        fixture.detectChanges();
        expect(headerResolvers).toHaveLength(2);
        expect(query('playback-diagnostic-banner')).toBeNull();

        headerResolvers[0](true);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(query('playback-diagnostic-banner')).toBeNull();

        headerResolvers[1](false);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(query('playback-diagnostic-banner')).toBeNull();

        setPlayback({ streamUrl: 'https://example.com/final.m3u8' });
        fixture.detectChanges();
        headerResolvers[2](true);
        await fixture.whenStable();
        expect(component.visiblePlaybackDiagnostic()).toBeNull();
        expect(component.vjsOptions).toEqual(
            expect.objectContaining({
                sources: [
                    expect.objectContaining({
                        src: 'https://example.com/final.m3u8',
                    }),
                ],
            })
        );
    });

    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    async function switchToHtml5(): Promise<void> {
        await render();
        vjs().playbackIssue.emit(mediaIssue('videojs'));
        fixture.detectChanges();
        click('playback-recommendation-html5');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    async function expectBindingChange(change: () => void): Promise<void> {
        const binding = component.activeBinding();
        change();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(component.activeBinding()).not.toBeNull();
        expect(component.activeBinding()).not.toBe(binding);
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

    function html5(): StubHtmlVideoPlayerComponent {
        return fixture.debugElement.query(
            By.directive(StubHtmlVideoPlayerComponent)
        ).componentInstance as StubHtmlVideoPlayerComponent;
    }

    function query(testId: string): HTMLElement | null {
        return fixture.nativeElement.querySelector(
            `[data-test-id="${testId}"]`
        );
    }

    function click(testId: string): void {
        requiredButton(testId).click();
    }

    function requiredButton(testId: string): HTMLButtonElement {
        const button = query(testId);
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

    interface TestTimeUpdateOwnership {
        readonly binding: unknown;
        readonly embeddedMpv: boolean;
        readonly isLive: boolean;
        readonly sourceRevision: symbol;
        readonly token: symbol;
    }

    function captureTimeUpdateOwnership(): TestTimeUpdateOwnership {
        const ownership = component.renderedApplications()[0];
        expect(ownership).toBeDefined();
        if (!ownership) {
            throw new Error('Expected a rendered playback application');
        }
        return ownership;
    }

    function deliverTimeUpdate(
        event: { readonly currentTime: number; readonly duration: number },
        ownership: TestTimeUpdateOwnership
    ): void {
        const handler = component.handleTimeUpdate as unknown as (
            event: { readonly currentTime: number; readonly duration: number },
            ownership: TestTimeUpdateOwnership
        ) => void;
        handler.call(component, event, ownership);
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

function mediaIssue(
    player: 'videojs' | 'html5',
    path = 'live.m3u8'
): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.MediaDecodeError,
        source: PlaybackDiagnosticSource.Vhs,
        sourceUrl: `https://example.com/${path}`,
        container: 'm3u8',
        mimeType: 'application/x-mpegURL',
        player,
        audioCodecs: [],
        videoCodecs: [],
    };
}

function networkIssue(player: 'videojs' | 'html5'): PlaybackDiagnostic {
    return {
        ...mediaIssue(player),
        code: PlaybackDiagnosticCode.NetworkError,
    };
}

function browserAccessIssue(player: 'videojs' | 'html5'): PlaybackDiagnostic {
    return {
        ...mediaIssue(player),
        code: PlaybackDiagnosticCode.BrowserAccessError,
    };
}
