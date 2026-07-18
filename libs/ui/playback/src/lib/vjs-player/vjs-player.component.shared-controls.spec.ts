import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { PlayerControlsComponent } from '../player-controls/player-controls.component';
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

describe('VjsPlayerComponent shared controls', () => {
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

    it('disables every Video.js interaction surface and renders shared controls', () => {
        fixture.componentRef.setInput('options', {
            sources: [{ src: 'https://example.test/movie.mp4' }],
            userActions: { custom: true, hotkeys: true },
            spatialNavigation: { custom: true, enabled: true },
        });

        fixture.detectChanges();
        playerHarness.ready();
        fixture.detectChanges();

        expect(videoJsMock).toHaveBeenCalledWith(
            expect.any(Element),
            expect.objectContaining({
                controls: false,
                userActions: {
                    custom: true,
                    click: false,
                    doubleClick: false,
                    hotkeys: false,
                },
                spatialNavigation: {
                    custom: true,
                    enabled: false,
                },
            }),
            expect.any(Function)
        );
        expect(
            fixture.debugElement.query(By.directive(PlayerControlsComponent))
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="series-playback-previous-episode"]'
            )
        ).toBeNull();
        expect(fixture.nativeElement.querySelector('video').controls).toBe(
            false
        );
    });

    it('gates the shared surface and shortcuts with interaction availability', () => {
        fixture.componentRef.setInput('options', {
            sources: [{ src: 'https://example.test/movie.mp4' }],
        });
        fixture.componentRef.setInput('interactionEnabled', false);

        fixture.detectChanges();
        playerHarness.ready();
        fixture.detectChanges();

        const controls = fixture.debugElement.query(
            By.directive(PlayerControlsComponent)
        ).componentInstance as PlayerControlsComponent;
        expect(controls.showControls()).toBe(false);
        expect(controls.shortcutsEnabled()).toBe(false);

        fixture.componentRef.setInput('interactionEnabled', true);
        fixture.detectChanges();

        expect(controls.showControls()).toBe(true);
        expect(controls.shortcutsEnabled()).toBe(true);
    });

    it('exits only its own fullscreen shell when interactions become unavailable', () => {
        fixture.componentRef.setInput('options', {
            sources: [{ src: 'https://example.test/movie.mp4' }],
        });
        fixture.detectChanges();
        playerHarness.ready();
        fixture.detectChanges();

        const shell = fixture.debugElement.query(By.css('.vjs-player-shell'))
            .nativeElement as HTMLElement;
        const unrelatedSurface = document.createElement('div');
        const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'fullscreenElement'
        );
        const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'exitFullscreen'
        );
        let fullscreenElement: Element | null = unrelatedSurface;
        const exitFullscreen = jest.fn().mockResolvedValue(undefined);

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exitFullscreen,
        });

        try {
            fixture.componentRef.setInput('interactionEnabled', false);
            fixture.detectChanges();
            expect(exitFullscreen).not.toHaveBeenCalled();

            fixture.componentRef.setInput('interactionEnabled', true);
            fixture.detectChanges();
            fullscreenElement = shell;
            fixture.componentRef.setInput('interactionEnabled', false);
            fixture.detectChanges();

            expect(exitFullscreen).toHaveBeenCalledTimes(1);
        } finally {
            restoreDocumentProperty(
                'fullscreenElement',
                fullscreenElementDescriptor
            );
            restoreDocumentProperty('exitFullscreen', exitFullscreenDescriptor);
        }
    });
});

function restoreDocumentProperty(
    property: 'exitFullscreen' | 'fullscreenElement',
    descriptor: PropertyDescriptor | undefined
): void {
    if (descriptor) {
        Object.defineProperty(document, property, descriptor);
        return;
    }

    delete (document as unknown as Record<string, unknown>)[property];
}

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
