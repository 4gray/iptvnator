import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '@iptvnator/playback/util';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import {
    STORE_KEY,
    VideoPlayer,
    type ExternalPlayerSession,
} from '@iptvnator/shared/interfaces';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import { of } from 'rxjs';
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

describe('WebPlayerViewComponent playback history', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let gate: PlaybackHistoryGate;

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    beforeEach(async () => {
        const externalSession = signal<ExternalPlayerSession | null>(null);
        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: StorageMap,
                    useValue: {
                        get: (key: string) =>
                            of(
                                key === STORE_KEY.Settings
                                    ? { player: VideoPlayer.VideoJs }
                                    : undefined
                            ),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: true },
                },
                {
                    provide: ElectronStreamHeadersService,
                    useValue: { apply: () => null, clear: jest.fn() },
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
                        activeSession: externalSession,
                        visibleSession: externalSession,
                        dismissActiveSession: jest.fn(),
                        closeSession: jest.fn(),
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
                    ],
                    // The diagnostic panel itself is not under test here.
                    schemas: [CUSTOM_ELEMENTS_SCHEMA],
                },
            })
            .compileComponents();

        gate = TestBed.inject(PlaybackHistoryGate);
        fixture = TestBed.createComponent(WebPlayerViewComponent);
        fixture.componentRef.setInput('streamUrl', 'https://example.com/a');
        fixture.componentRef.setInput('title', 'Channel A');
        fixture.componentRef.setInput('playbackSessionKey', 'live:p1:a');
        await render();
    });

    afterEach(() => fixture.destroy());

    it('records a channel once its stream has played for two seconds', () => {
        const commit = jest.fn();
        gate.defer({ sessionKey: 'live:p1:a' }, commit);

        playTo(0, 1);
        expect(commit).not.toHaveBeenCalled();

        playTo(2);
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('confirms by stream URL for writers that only know the link', () => {
        const commit = jest.fn();
        gate.defer({ streamUrls: ['https://example.com/a'] }, commit);

        playTo(0, 1, 2);

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('does not record a channel whose stream fails before playing', () => {
        const commit = jest.fn();
        gate.defer({ sessionKey: 'live:p1:a' }, commit);

        playTo(0);
        vjs().playbackIssue.emit({
            code: PlaybackDiagnosticCode.MediaDecodeError,
            source: PlaybackDiagnosticSource.Vhs,
            sourceUrl: 'https://example.com/a',
            container: 'm3u8',
            mimeType: 'application/x-mpegURL',
            player: 'videojs',
            audioCodecs: [],
            videoCodecs: [],
        });
        fixture.detectChanges();

        expect(commit).not.toHaveBeenCalled();
    });

    it('does not count seeks of paused media as watched time', () => {
        const commit = jest.fn();
        gate.defer({ sessionKey: 'live:p1:a' }, commit);

        [0, 1, 2, 3].forEach((currentTime) =>
            vjs().timeUpdate.emit({ currentTime, duration: 0, playing: false })
        );

        expect(commit).not.toHaveBeenCalled();
    });

    it('does not credit the next channel with the previous one', async () => {
        const next = jest.fn();
        playTo(0, 1.5);

        fixture.componentRef.setInput('streamUrl', 'https://example.com/b');
        fixture.componentRef.setInput('playbackSessionKey', 'live:p1:b');
        gate.defer({ sessionKey: 'live:p1:b' }, next);
        await render();
        playTo(0, 0.5);

        expect(next).not.toHaveBeenCalled();

        playTo(1, 2);
        expect(next).toHaveBeenCalledTimes(1);
    });

    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    function playTo(...positions: number[]): void {
        positions.forEach((currentTime) =>
            vjs().timeUpdate.emit({ currentTime, duration: 0 })
        );
    }

    function vjs(): StubVjsPlayerComponent {
        return fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            .componentInstance as StubVjsPlayerComponent;
    }
});
