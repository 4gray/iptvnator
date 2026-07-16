import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls/web-player-controls.flag';
import type { VjsPlayerComponent as VjsPlayerComponentInstance } from './vjs-player.component';
import type { VideoJsPlayer } from './vjs-player.types';

const videoJsMock = jest.fn();
const mpegTsCreatePlayerMock = jest.fn();
const mpegTsIsSupportedMock = jest.fn(() => true);

jest.unstable_mockModule('video.js', () => ({
    default: videoJsMock,
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));
jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: mpegTsCreatePlayerMock,
        isSupported: mpegTsIsSupportedMock,
    },
}));

describe('VjsPlayerComponent reset lifecycle', () => {
    let VjsPlayerComponent: typeof import('./vjs-player.component').VjsPlayerComponent;
    let fixture: ComponentFixture<VjsPlayerComponentInstance>;
    let playerHarness: ReturnType<typeof createVideoJsPlayerHarness>;

    beforeAll(async () => {
        ({ VjsPlayerComponent } = await import('./vjs-player.component'));
    });

    beforeEach(async () => {
        playerHarness = createVideoJsPlayerHarness();
        videoJsMock
            .mockReset()
            .mockImplementation(
                (_target: Element, _options: unknown, ready: () => void) => {
                    playerHarness.ready = ready;
                    return playerHarness.player;
                }
            );
        mpegTsCreatePlayerMock.mockReset().mockImplementation(() => {
            const engine = createMpegTsPlayer();
            playerHarness.mpegTsPlayers.push(engine);
            return engine;
        });
        mpegTsIsSupportedMock.mockReset().mockReturnValue(true);

        await TestBed.configureTestingModule({
            imports: [VjsPlayerComponent, TranslateModule.forRoot()],
            providers: [
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: true },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(VjsPlayerComponent);
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('coalesces reset-required changes and attaches only the latest MPEG-TS source', () => {
        const initialVideo = document.createElement('video');
        playerHarness.currentVideo = initialVideo;
        fixture.componentRef.setInput('options', {
            isLive: true,
            sources: [
                {
                    src: 'https://example.test/live/one.ts',
                    type: 'video/mp2t',
                },
            ],
        });
        fixture.detectChanges();
        playerHarness.ready();

        expect(playerHarness.mpegTsPlayers).toHaveLength(1);
        expect(
            playerHarness.mpegTsPlayers[0].attachMediaElement
        ).toHaveBeenCalledWith(initialVideo);

        fixture.componentRef.setInput('options', {
            isLive: true,
            sources: [
                {
                    src: 'https://example.test/live/two.ts',
                    type: 'video/mp2t',
                },
            ],
        });
        fixture.detectChanges();
        fixture.componentRef.setInput('options', {
            isLive: true,
            sources: [
                {
                    src: 'https://example.test/live/three.ts',
                    type: 'video/mp2t',
                },
            ],
        });
        fixture.detectChanges();

        expect(playerHarness.reset).toHaveBeenCalledTimes(1);
        expect(playerHarness.mpegTsPlayers).toHaveLength(1);
        expect(playerHarness.mpegTsPlayers[0].destroy).toHaveBeenCalledTimes(1);

        const latestVideo = document.createElement('video');
        playerHarness.currentVideo = latestVideo;
        playerHarness.emit('playerreset');

        expect(playerHarness.mpegTsPlayers).toHaveLength(2);
        expect(mpegTsCreatePlayerMock).toHaveBeenLastCalledWith({
            type: 'mpegts',
            isLive: true,
            url: 'https://example.test/live/three.ts',
        });
        expect(
            playerHarness.mpegTsPlayers[1].attachMediaElement
        ).toHaveBeenCalledWith(latestVideo);
    });

    it('never calls Video.js reset until active playback has paused', () => {
        fixture.componentRef.setInput('options', {
            sources: [{ src: 'https://example.test/movie.mp4' }],
        });
        fixture.detectChanges();
        playerHarness.ready();
        playerHarness.paused = false;
        playerHarness.pauseCompletesImmediately = false;

        fixture.componentRef.setInput('options', {
            isLive: true,
            sources: [
                {
                    src: 'https://example.test/live/stream.ts',
                    type: 'video/mp2t',
                },
            ],
        });
        fixture.detectChanges();

        expect(playerHarness.pause).toHaveBeenCalledTimes(1);
        expect(playerHarness.reset).not.toHaveBeenCalled();

        playerHarness.paused = true;
        playerHarness.emit('pause');

        expect(playerHarness.reset).toHaveBeenCalledTimes(1);
    });

    it('restores the latest normal source after an already-started reset', () => {
        fixture.componentRef.setInput('options', {
            sources: [{ src: 'https://example.test/movie.mp4' }],
        });
        fixture.detectChanges();
        playerHarness.ready();

        fixture.componentRef.setInput('options', {
            isLive: true,
            sources: [
                {
                    src: 'https://example.test/live/stream.ts',
                    type: 'video/mp2t',
                },
            ],
        });
        fixture.detectChanges();

        const latestSource = {
            src: 'https://example.test/latest.mp4',
            type: 'video/mp4',
        };
        fixture.componentRef.setInput('options', {
            isLive: false,
            sources: [latestSource],
        });
        fixture.detectChanges();

        expect(playerHarness.src).not.toHaveBeenCalledWith(latestSource);

        playerHarness.currentVideo = document.createElement('video');
        playerHarness.emit('playerreset');

        expect(playerHarness.src).toHaveBeenLastCalledWith(latestSource);
        expect(playerHarness.mpegTsPlayers).toHaveLength(0);
    });

    it('does not start MPEG-TS twice when playerreset precedes Video.js ready', () => {
        fixture.componentRef.setInput('options', {
            isLive: true,
            sources: [
                {
                    src: 'https://example.test/live/one.ts',
                    type: 'video/mp2t',
                },
            ],
        });
        fixture.detectChanges();

        fixture.componentRef.setInput('options', {
            isLive: true,
            sources: [
                {
                    src: 'https://example.test/live/two.ts',
                    type: 'video/mp2t',
                },
            ],
        });
        fixture.detectChanges();
        playerHarness.currentVideo = document.createElement('video');
        playerHarness.emit('playerreset');

        expect(playerHarness.mpegTsPlayers).toHaveLength(1);

        playerHarness.ready();

        expect(playerHarness.mpegTsPlayers).toHaveLength(1);
        expect(mpegTsCreatePlayerMock).toHaveBeenLastCalledWith({
            type: 'mpegts',
            isLive: true,
            url: 'https://example.test/live/two.ts',
        });
    });

    it('restarts active MPEG-TS when authoritative live metadata changes', () => {
        const source = {
            src: 'https://example.test/live/stream.ts',
            type: 'video/mp2t',
        };
        fixture.componentRef.setInput('options', {
            isLive: true,
            sources: [source],
        });
        fixture.detectChanges();
        playerHarness.ready();

        fixture.componentRef.setInput('options', {
            isLive: false,
            sources: [{ ...source }],
        });
        fixture.detectChanges();

        expect(playerHarness.reset).toHaveBeenCalledTimes(1);
        expect(playerHarness.mpegTsPlayers[0].destroy).toHaveBeenCalledTimes(1);

        playerHarness.currentVideo = document.createElement('video');
        playerHarness.emit('playerreset');

        expect(mpegTsCreatePlayerMock).toHaveBeenLastCalledWith({
            type: 'mpegts',
            isLive: false,
            url: source.src,
        });
        expect(playerHarness.mpegTsPlayers).toHaveLength(2);
    });
});

function createVideoJsPlayerHarness() {
    const listeners = new Map<string, Set<() => void>>();
    const harness = {
        currentVideo: document.createElement('video'),
        paused: true,
        pauseCompletesImmediately: true,
        ready: () => undefined,
        mpegTsPlayers: [] as ReturnType<typeof createMpegTsPlayer>[],
        pause: jest.fn(() => {
            if (harness.pauseCompletesImmediately) {
                harness.paused = true;
            }
        }),
        reset: jest.fn(),
        src: jest.fn(),
        emit(event: string) {
            for (const listener of listeners.get(event) ?? []) {
                listener();
            }
        },
        player: null as unknown as VideoJsPlayer,
    };
    harness.player = {
        audioTracks: jest.fn(() => null),
        textTracks: jest.fn(() => null),
        currentTime: jest.fn(() => 0),
        duration: jest.fn(() => 0),
        error: jest.fn(() => null),
        getChild: jest.fn(() => null),
        on: jest.fn((event: string, listener: () => void) => {
            const eventListeners =
                listeners.get(event) ?? new Set<() => void>();
            eventListeners.add(listener);
            listeners.set(event, eventListeners);
        }),
        off: jest.fn((event: string, listener: () => void) => {
            listeners.get(event)?.delete(listener);
        }),
        pause: harness.pause,
        paused: jest.fn(() => harness.paused),
        reset: harness.reset,
        src: harness.src,
        tech: jest.fn(() => ({ el: () => harness.currentVideo })),
        volume: jest.fn(() => 0.5),
        dispose: jest.fn(),
        qualitySelectorHls: jest.fn(),
        aspectRatioPanel: jest.fn(),
    } as unknown as VideoJsPlayer;
    return harness;
}

function createMpegTsPlayer() {
    return {
        attachMediaElement: jest.fn(),
        load: jest.fn(),
        play: jest.fn(),
        pause: jest.fn(),
        unload: jest.fn(),
        detachMediaElement: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        off: jest.fn(),
    };
}
