import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

describe('EmbeddedMpvSessionController', () => {
    let electron: {
        platform: string;
        getEmbeddedMpvSupport: jest.Mock;
        prepareEmbeddedMpv: jest.Mock;
        createEmbeddedMpvSession: jest.Mock;
        loadEmbeddedMpvPlayback: jest.Mock;
        disposeEmbeddedMpvSession: jest.Mock;
        setEmbeddedMpvBounds: jest.Mock;
        onEmbeddedMpvSessionUpdate: jest.Mock;
        setEmbeddedMpvPaused: jest.Mock;
        seekEmbeddedMpv: jest.Mock;
        setEmbeddedMpvVolume: jest.Mock;
    };
    let sessionUpdate: ((session: EmbeddedMpvSession) => void) | null;
    let unsubscribeSessionUpdate: jest.Mock;
    let testingModuleDestroyed: boolean;

    beforeEach(() => {
        testingModuleDestroyed = false;
        sessionUpdate = null;
        unsubscribeSessionUpdate = jest.fn();
        electron = {
            platform: 'darwin',
            getEmbeddedMpvSupport: jest.fn().mockResolvedValue({
                supported: true,
                platform: 'darwin',
            }),
            prepareEmbeddedMpv: jest.fn().mockResolvedValue({
                supported: true,
                platform: 'darwin',
            }),
            createEmbeddedMpvSession: jest
                .fn()
                .mockResolvedValue(createSession({ id: 'mpv-1' })),
            loadEmbeddedMpvPlayback: jest.fn().mockResolvedValue(undefined),
            disposeEmbeddedMpvSession: jest.fn().mockResolvedValue(undefined),
            setEmbeddedMpvBounds: jest.fn().mockResolvedValue(undefined),
            onEmbeddedMpvSessionUpdate: jest.fn((callback) => {
                sessionUpdate = callback;
                return unsubscribeSessionUpdate;
            }),
            setEmbeddedMpvPaused: jest.fn().mockResolvedValue(
                createSession({
                    id: 'mpv-1',
                    status: 'paused',
                })
            ),
            seekEmbeddedMpv: jest.fn().mockResolvedValue(
                createSession({
                    id: 'mpv-1',
                    positionSeconds: 15,
                })
            ),
            setEmbeddedMpvVolume: jest.fn().mockResolvedValue(
                createSession({
                    id: 'mpv-1',
                    volume: 0.25,
                })
            ),
        };
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: electron,
        });
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: class MockResizeObserver {
                observe = jest.fn();
                disconnect = jest.fn();
            },
        });
        Object.defineProperty(window, 'requestAnimationFrame', {
            configurable: true,
            value: (callback: FrameRequestCallback) => {
                return window.setTimeout(() => callback(0), 0);
            },
        });
        Object.defineProperty(window, 'cancelAnimationFrame', {
            configurable: true,
            value: (handle: number) => window.clearTimeout(handle),
        });

        TestBed.configureTestingModule({
            providers: [EmbeddedMpvSessionController],
        });
    });

    afterEach(() => {
        if (!testingModuleDestroyed) {
            TestBed.resetTestingModule();
        }
        delete (window as unknown as { electron?: unknown }).electron;
        jest.restoreAllMocks();
    });

    function destroyTestingModule(): void {
        TestBed.resetTestingModule();
        testingModuleDestroyed = true;
    }

    it('loads support and unsubscribes from session updates on destroy', async () => {
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        await waitFor(() => controller.support() !== null, 'support to load');

        expect(electron.getEmbeddedMpvSupport).toHaveBeenCalled();
        expect(controller.support()).toEqual({
            supported: true,
            platform: 'darwin',
        });

        destroyTestingModule();
        expect(unsubscribeSessionUpdate).toHaveBeenCalled();
    });

    it('starts a session, forwards matching updates, and disposes on teardown', async () => {
        const controller = TestBed.inject(EmbeddedMpvSessionController);
        const host = createHost();
        const playback = createPlayback();

        const teardown = controller.startSession(host, playback, 0.7);
        expect(controller.session()).toEqual(
            expect.objectContaining({
                id: 'embedded-mpv-starting',
                status: 'loading',
                volume: 0.7,
            })
        );

        await waitFor(
            () => controller.sessionId() === 'mpv-1',
            'session to start'
        );

        expect(electron.prepareEmbeddedMpv).toHaveBeenCalled();
        expect(electron.createEmbeddedMpvSession).toHaveBeenCalledWith(
            { x: 11, y: 21, width: 640, height: 360 },
            'Example Movie',
            0.7
        );
        expect(electron.loadEmbeddedMpvPlayback).toHaveBeenCalledWith(
            'mpv-1',
            playback
        );
        expect(controller.sessionId()).toBe('mpv-1');

        sessionUpdate?.(createSession({ id: 'other', status: 'paused' }));
        expect(controller.session()?.status).toBe('playing');

        sessionUpdate?.(createSession({ id: 'mpv-1', status: 'paused' }));
        expect(controller.session()?.status).toBe('paused');

        teardown();

        expect(controller.session()).toBeNull();
        expect(controller.sessionId()).toBeNull();
        expect(electron.disposeEmbeddedMpvSession).toHaveBeenCalledWith(
            'mpv-1'
        );
    });

    it('sets an error session when Electron cannot create playback', async () => {
        electron.prepareEmbeddedMpv.mockRejectedValueOnce(
            new Error('native module missing')
        );
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        controller.startSession(createHost(), createPlayback(), 0.5);
        await waitFor(
            () => controller.session()?.status === 'error',
            'error session to be set'
        );

        expect(controller.session()).toEqual(
            expect.objectContaining({
                id: 'embedded-mpv-error',
                status: 'error',
                error: 'native module missing',
            })
        );
        expect(controller.sessionId()).toBeNull();
    });

    it('forwards playback commands and updates session snapshots', async () => {
        const controller = TestBed.inject(EmbeddedMpvSessionController);
        controller.sessionId.set('mpv-1');
        controller.session.set(
            createSession({
                id: 'mpv-1',
                status: 'playing',
                positionSeconds: 3,
            })
        );

        await controller.togglePaused();
        expect(electron.setEmbeddedMpvPaused).toHaveBeenCalledWith(
            'mpv-1',
            true
        );
        expect(controller.session()?.status).toBe('paused');

        await controller.seekBy(-30);
        expect(electron.seekEmbeddedMpv).toHaveBeenCalledWith('mpv-1', 0);
        expect(controller.session()?.positionSeconds).toBe(15);

        await controller.applyVolume(0.25);
        expect(electron.setEmbeddedMpvVolume).toHaveBeenCalledWith(
            'mpv-1',
            0.25
        );
        expect(controller.session()?.volume).toBe(0.25);
    });

    it('swallows command errors so stale IPC races do not clear current state', async () => {
        const controller = TestBed.inject(EmbeddedMpvSessionController);
        const current = createSession({ id: 'mpv-1', volume: 0.8 });
        controller.sessionId.set('mpv-1');
        controller.session.set(current);
        electron.setEmbeddedMpvVolume.mockRejectedValueOnce(
            new Error('session disposed')
        );

        await controller.applyVolume(0.25);

        expect(controller.session()).toBe(current);
    });
});

function createHost(): HTMLElement {
    return {
        getBoundingClientRect: () => ({
            left: 10.6,
            top: 20.5,
            width: 640,
            height: 360,
        }),
    } as HTMLElement;
}

function createPlayback(): ResolvedPortalPlayback {
    return {
        streamUrl: 'https://example.com/movie.mp4',
        title: 'Example Movie',
    };
}

function createSession(
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id: 'mpv-1',
        title: 'Example Movie',
        streamUrl: 'https://example.com/movie.mp4',
        status: 'playing',
        positionSeconds: 10,
        durationSeconds: 120,
        volume: 0.7,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        recording: { active: false },
        startedAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:01.000Z',
        ...overrides,
    };
}

async function waitFor(
    condition: () => boolean,
    description: string
): Promise<void> {
    const deadline = Date.now() + 1_000;

    while (Date.now() < deadline) {
        if (condition()) {
            return;
        }
        await Promise.resolve();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    throw new Error(`Timed out waiting for ${description}`);
}
