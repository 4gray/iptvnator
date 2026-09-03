import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ChangeDetectionStrategy,
    Component,
    signal,
    type Type,
} from '@angular/core';
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
import { of } from 'rxjs';
import {
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls';
import {
    StubArtPlayerComponent,
    StubEmbeddedMpvPlayerComponent,
    StubFullscreenChannelPanelComponent,
    StubHtmlVideoPlayerComponent,
    StubVjsPlayerComponent,
} from './web-player-view.spec-stubs';
import {
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '@iptvnator/playback/util';
import { PlaybackDiagnosticPanelComponent } from '../playback-diagnostic-panel/playback-diagnostic-panel.component';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

const webPlayerSharedControls = signal(false);
const showCaptionsSetting = signal(false);

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
        showCaptionsSetting.set(false);

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
                    useValue: {
                        webPlayerSharedControls,
                        showCaptions: showCaptionsSetting,
                    },
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
                        ClipboardModule,
                        MatButtonModule,
                        MatIconModule,
                        MatTooltipModule,
                        TranslateModule,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WebPlayerViewComponent);
        fixture.componentRef.setInput('playbackSessionKey', 'test-session');
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
        fixture.componentRef.setInput('playbackSessionKey', 'test-session');
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

    it('falls back to the default-on rollout flag when the store has no boolean', () => {
        webPlayerSharedControls.set(undefined as unknown as boolean);
        fixture.detectChanges();

        expect(
            fixture.debugElement.injector.get(WEB_PLAYER_SHARED_CONTROLS)
        ).toBe(true);
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

    // Regression for #1155: portal hosts never bound a showCaptions input, so
    // the preference has to come from the settings store instead.
    it('reads the caption preference from settings without a host binding', async () => {
        showCaptionsSetting.set(true);

        const htmlPlayer = await renderHtmlPlayer();

        expect(htmlPlayer.showCaptions()).toBe(true);

        showCaptionsSetting.set(false);
        fixture.detectChanges();

        expect(htmlPlayer.showCaptions()).toBe(false);
    });

    it('passes resolved playback metadata and caption preference to Video.js', async () => {
        showCaptionsSetting.set(true);

        const vjsPlayer = await renderVjsPlayer({ isLive: false });

        expect(vjsPlayer.options()).toEqual(
            expect.objectContaining({ isLive: false })
        );
        expect(vjsPlayer.showCaptions()).toBe(true);
        expect(vjsPlayer.interactionEnabled()).toBe(true);
    });

    it('passes resolved playback metadata and diagnostic interaction state to ArtPlayer', async () => {
        showCaptionsSetting.set(true);

        const artPlayer = await renderArtPlayer({ isLive: false });

        expect(artPlayer.isLive()).toBe(false);
        expect(artPlayer.showCaptions()).toBe(true);
        expect(artPlayer.interactionEnabled()).toBe(true);

        emitPlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(artPlayer.interactionEnabled()).toBe(false);

        emitPlaybackIssue(null);
        fixture.detectChanges();
        expect(artPlayer.interactionEnabled()).toBe(true);
    });

    it('disables HTML5 surface interaction while a diagnostic is visible', async () => {
        const htmlPlayer = await renderHtmlPlayer();

        emitPlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();

        expect(component.playbackInteractionEnabled()).toBe(false);
        expect(htmlPlayer.interactionEnabled()).toBe(false);
    });

    it('re-enables HTML5 interaction after retrying or clearing the issue', async () => {
        const htmlPlayer = await renderHtmlPlayer();

        emitPlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(htmlPlayer.interactionEnabled()).toBe(false);

        component.retryPlayback();
        fixture.detectChanges();
        const retriedHtmlPlayer = fixture.debugElement.query(
            By.directive(StubHtmlVideoPlayerComponent)
        ).componentInstance as StubHtmlVideoPlayerComponent;
        expect(component.playbackInteractionEnabled()).toBe(true);
        expect(retriedHtmlPlayer.interactionEnabled()).toBe(true);

        emitPlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(retriedHtmlPlayer.interactionEnabled()).toBe(false);

        emitPlaybackIssue(null);
        fixture.detectChanges();
        expect(component.playbackInteractionEnabled()).toBe(true);
        expect(retriedHtmlPlayer.interactionEnabled()).toBe(true);
    });

    it('disables and restores Video.js interaction around diagnostics', async () => {
        const vjsPlayer = await renderVjsPlayer();

        emitPlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(vjsPlayer.interactionEnabled()).toBe(false);

        component.retryPlayback();
        fixture.detectChanges();
        const retriedVjsPlayer = fixture.debugElement.query(
            By.directive(StubVjsPlayerComponent)
        ).componentInstance as StubVjsPlayerComponent;
        expect(retriedVjsPlayer.interactionEnabled()).toBe(true);

        emitPlaybackIssue(createNetworkDiagnostic());
        fixture.detectChanges();
        expect(retriedVjsPlayer.interactionEnabled()).toBe(false);

        emitPlaybackIssue(null);
        fixture.detectChanges();
        expect(retriedVjsPlayer.interactionEnabled()).toBe(true);
    });

    it('renders the engine when the Electron header handoff lands after the mounting pass under an OnPush host', async () => {
        // Electron hands the source over inside the setUserAgent promise,
        // i.e. after the change-detection pass that mounted the application.
        // Real hosts (PortalInlinePlayerComponent) are OnPush, so nothing
        // re-checks this view on its own — the handoff has to mark it. It
        // used to ride on the fullscreen exit's stage resize on every episode
        // switch, which the host-owned fullscreen removed.
        // Every apply gets its own pending promise: a superseded apply (the
        // view can restart the application while settling) must resolve too,
        // and only the newest one hands the source over.
        const resolvers: Array<(value: boolean) => void> = [];
        const setUserAgent = jest.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    resolvers.push(resolve);
                })
        );
        (window as unknown as { electron?: unknown }).electron = {
            setUserAgent,
        };
        const RootHostComponent = createOnPushHostTree(WebPlayerViewComponent, {
            streamUrl: 'https://example.com/episode-1.mp4',
            title: 'Episode 1',
            contentInfo: createVodContentInfo(),
        });
        const hostFixture = TestBed.createComponent(RootHostComponent);
        try {
            // Let the @defer block settle first: its completion marks the
            // tree for refresh on its own, which would mask the bug if the
            // header promise resolved in the same microtask flush.
            hostFixture.detectChanges();
            await hostFixture.whenStable();
            hostFixture.detectChanges();
            expect(setUserAgent).toHaveBeenCalled();
            expect(
                hostFixture.debugElement.query(
                    By.directive(StubVjsPlayerComponent)
                )
            ).toBeNull();

            for (const resolve of resolvers.splice(0)) {
                resolve(true);
            }
            await hostFixture.whenStable();
            hostFixture.detectChanges();

            expect(
                hostFixture.debugElement.query(
                    By.directive(StubVjsPlayerComponent)
                )
            ).not.toBeNull();
        } finally {
            hostFixture.destroy();
            delete (window as unknown as { electron?: unknown }).electron;
        }
    });

    it.each([
        [
            'HTML5',
            () => renderHtmlPlayer({ contentInfo: createVodContentInfo() }),
        ],
        [
            'Video.js',
            () => renderVjsPlayer({ contentInfo: createVodContentInfo() }),
        ],
        [
            'ArtPlayer',
            () => renderArtPlayer({ contentInfo: createVodContentInfo() }),
        ],
    ])(
        'keeps the host as the one fullscreen owner across a %s application remount',
        async (_engine, renderPlayer) => {
            const player = await renderPlayer();
            const host = fixture.nativeElement as HTMLElement;
            expect(player.fullscreenTarget()).toBe(host);

            // The next episode is a new playback object, which remounts the
            // engine component (new application token). The fullscreen owner
            // must not be that component, or the Fullscreen API would exit
            // the moment the old shell leaves the document.
            setPlayback(
                {
                    contentInfo: {
                        ...createVodContentInfo(),
                        contentXtreamId: 124,
                    },
                },
                'https://example.com/episode-2.mp4'
            );
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            const remounted = fixture.debugElement.query(
                By.directive(player.constructor as never)
            ).componentInstance as { fullscreenTarget(): HTMLElement | null };
            expect(remounted).not.toBe(player);
            expect(remounted.fullscreenTarget()).toBe(host);
            expect(host.isConnected).toBe(true);
        }
    );

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
            setPlayback(metadata, streamUrl);

            fixture.detectChanges();

            expect(component.vjsOptions()).toEqual(
                expect.objectContaining({ isLive: expected, reloadToken: 0 })
            );

            component.retryPlayback();
            fixture.detectChanges();

            expect(component.vjsOptions()).toEqual(
                expect.objectContaining({ isLive: expected, reloadToken: 1 })
            );
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

    function emitPlaybackIssue(issue: PlaybackDiagnostic | null): void {
        fixture.detectChanges();
        const binding = component.activeBinding();
        expect(binding).not.toBeNull();
        if (!binding) {
            throw new Error('Expected an active inline playback binding');
        }
        component.handlePlaybackIssue(issue, binding);
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
    };
}

/**
 * Root (default CD) → OnPush middle → app-web-player-view. `detectChanges()`
 * on the root refreshes the root itself unconditionally, so the OnPush layer
 * has to sit in between for the "not dirty, skipped" case to exist.
 */
function createOnPushHostTree(
    WebPlayerView: Type<unknown>,
    playback: ResolvedPortalPlayback
): Type<unknown> {
    @Component({
        selector: 'app-onpush-player-host',
        imports: [WebPlayerView],
        changeDetection: ChangeDetectionStrategy.OnPush,
        template: `<app-web-player-view
            playbackSessionKey="onpush-host"
            [streamUrl]="playback.streamUrl"
            [playback]="playback"
        />`,
    })
    class OnPushPlayerHostComponent {
        readonly playback = playback;
    }

    @Component({
        selector: 'app-root-player-host',
        imports: [OnPushPlayerHostComponent],
        template: '<app-onpush-player-host />',
    })
    class RootPlayerHostComponent {}

    return RootPlayerHostComponent;
}
