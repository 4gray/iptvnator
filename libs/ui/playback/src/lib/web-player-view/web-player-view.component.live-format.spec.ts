import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { DestroyRef, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    type ExternalPlayerSession,
    STORE_KEY,
    VideoPlayer,
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

describe('WebPlayerViewComponent live format integration', () => {
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

    it('tries advertised TS once after initial terminal HLS HTTP failure', async () => {
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/live.m3u8',
            title: 'Live',
            isLive: true,
            liveAutoTsUrl: 'https://example.com/live.ts',
            headers: { 'User-Agent': 'fixture-agent' },
        });
        await render();
        const oldBinding = currentBinding();
        component.handlePlaybackIssue(
            { ...networkIssue('videojs'), httpStatus: 403 },
            oldBinding
        );
        await render();
        expect(component.resolvedPlayback().streamUrl).toBe(
            'https://example.com/live.ts'
        );
        expect(component.resolvedPlayback().headers).toEqual({
            'User-Agent': 'fixture-agent',
        });
        expect(component.selectedPlayer()).toBe(VideoPlayer.VideoJs);
        const tsBinding = currentBinding();
        component.handlePlaybackIssue(networkIssue('videojs'), tsBinding);
        await render();
        expect(component.activeBinding()).toBe(tsBinding);
        expect(component.visiblePlaybackDiagnostic()).not.toBeNull();
        component.handlePlaybackIssue(networkIssue('videojs'), oldBinding);
        expect(component.activeBinding()).toBe(tsBinding);
    });

    it('uses actual playing output to suppress fallback after playback starts', async () => {
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/live.m3u8',
            title: 'Live',
            isLive: true,
            liveAutoTsUrl: 'https://example.com/live.ts',
        });
        await render();
        const player = fixture.debugElement.query(
            By.directive(StubVjsPlayerComponent)
        ).componentInstance as StubVjsPlayerComponent;
        player.playbackStarted.emit();
        player.playbackIssue.emit({
            ...networkIssue('videojs'),
            httpStatus: 403,
        });
        await render();
        expect(component.resolvedPlayback().streamUrl).toBe(
            'https://example.com/live.m3u8'
        );
        expect(component.visiblePlaybackDiagnostic()).not.toBeNull();
    });

    it('destroys the previous transport before the TS header handoff', async () => {
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/live.m3u8',
            title: 'Live',
            isLive: true,
            liveAutoTsUrl: 'https://example.com/live.ts',
        });
        await render();
        const player = fixture.debugElement.query(
            By.directive(StubVjsPlayerComponent)
        );
        const events: string[] = [];
        player.injector
            .get(DestroyRef)
            .onDestroy(() => events.push('destroy-hls'));
        streamHeaders.apply.mockImplementationOnce(() => {
            events.push('ts-headers');
            return null;
        });
        (player.componentInstance as StubVjsPlayerComponent).playbackIssue.emit(
            { ...networkIssue('videojs'), httpStatus: 403 }
        );
        await render();
        expect(events).toEqual(['destroy-hls', 'ts-headers']);
    });

    it('ignores playing and failure from the old channel before the new render', async () => {
        await render();
        const oldBinding = currentBinding();
        fixture.componentRef.setInput(
            'playbackSessionKey',
            'another-playlist/channel'
        );
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/new.m3u8',
            title: 'Live',
            isLive: true,
            liveAutoTsUrl: 'https://example.com/new.ts',
        });
        component.handlePlaybackStarted(oldBinding);
        component.handlePlaybackIssue(
            { ...networkIssue('videojs'), httpStatus: 403 },
            oldBinding
        );
        await render();
        const binding = currentBinding();
        component.handlePlaybackIssue(
            { ...networkIssue('videojs'), httpStatus: 403 },
            binding
        );
        await render();
        expect(component.resolvedPlayback().streamUrl).toBe(
            'https://example.com/new.ts'
        );
    });

    function currentBinding() {
        const current = component.activeBinding();
        if (!current) throw new Error('Expected a mounted playback binding');
        return current;
    }

    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }
});
function networkIssue(player: 'videojs' | 'html5'): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Vhs,
        sourceUrl: 'https://example.com/live.m3u8',
        container: 'm3u8',
        player,
        audioCodecs: [],
        videoCodecs: [],
    };
}
