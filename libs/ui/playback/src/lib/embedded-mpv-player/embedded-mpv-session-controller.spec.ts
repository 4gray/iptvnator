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
        seekEmbeddedMpvBy: jest.Mock;
        setEmbeddedMpvVolume: jest.Mock;
    };
    let sessionUpdate: ((session: EmbeddedMpvSession) => void) | null;
    let unsubscribeSessionUpdate: jest.Mock;
    let testingModuleDestroyed: boolean;

    beforeEach(() => {
        // Fake timers before anything else: the controller's startup chain is
        // driven from here (see `waitFor`), and the rAF shim below defers
        // through `setTimeout`, so it has to resolve to the faked one.
        jest.useFakeTimers();
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
            seekEmbeddedMpvBy: jest.fn().mockResolvedValue(
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
        // After teardown has cancelled the controller's timers, so the stalled
        // tracker's 30s timeout never leaks into the real timer queue.
        jest.useRealTimers();
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
        // Fractional CSS edges stay unrounded: the main process rounds once,
        // after converting them to native units.
        expect(electron.createEmbeddedMpvSession).toHaveBeenCalledWith(
            { x: 10.6, y: 20.5, width: 640, height: 360 },
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

    it('ignores a late startup rejection after teardown so it cannot clobber a newer session', async () => {
        let rejectPrepare: ((error: Error) => void) | null = null;
        electron.prepareEmbeddedMpv.mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    rejectPrepare = reject;
                })
        );
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        const teardown = controller.startSession(
            createHost(),
            createPlayback(),
            0.5
        );
        await waitFor(
            () => rejectPrepare !== null,
            'startup to reach prepareEmbeddedMpv'
        );
        teardown();

        // A newer session replaces the torn-down one (fast channel zapping).
        const newer = createSession({ id: 'mpv-2' });
        controller.sessionId.set('mpv-2');
        controller.session.set(newer);

        rejectPrepare?.(new Error('native module missing'));
        await flush();

        expect(controller.session()).toBe(newer);
        expect(controller.sessionId()).toBe('mpv-2');
    });

    it('delegates track, speed, aspect, and recording commands to the runner', async () => {
        const commandBridge = {
            setEmbeddedMpvAudioTrack: jest.fn().mockResolvedValue(null),
            setEmbeddedMpvSubtitleTrack: jest.fn().mockResolvedValue(null),
            setEmbeddedMpvSpeed: jest.fn().mockResolvedValue(null),
            setEmbeddedMpvAspect: jest.fn().mockResolvedValue(null),
            seekEmbeddedMpv: jest.fn().mockResolvedValue(null),
            startEmbeddedMpvRecording: jest.fn().mockResolvedValue(
                createSession({
                    recording: { active: true, targetPath: '/tmp/rec.ts' },
                })
            ),
            stopEmbeddedMpvRecording: jest
                .fn()
                .mockResolvedValue(
                    createSession({ recording: { active: false } })
                ),
        };
        Object.assign(electron, commandBridge);
        const controller = TestBed.inject(EmbeddedMpvSessionController);
        controller.sessionId.set('mpv-1');
        controller.session.set(createSession());

        await controller.seekTo(75);
        await controller.setAudioTrack(2);
        await controller.setSubtitleTrack(-1);
        await controller.setSpeed(1.5);
        await controller.setAspect('16:9');
        const started = await controller.startRecording('/rec', 'Show');
        const stopped = await controller.stopRecording();

        expect(commandBridge.seekEmbeddedMpv).toHaveBeenCalledWith('mpv-1', 75);
        expect(commandBridge.setEmbeddedMpvAudioTrack).toHaveBeenCalledWith(
            'mpv-1',
            2
        );
        expect(commandBridge.setEmbeddedMpvSubtitleTrack).toHaveBeenCalledWith(
            'mpv-1',
            -1
        );
        expect(commandBridge.setEmbeddedMpvSpeed).toHaveBeenCalledWith(
            'mpv-1',
            1.5
        );
        expect(commandBridge.setEmbeddedMpvAspect).toHaveBeenCalledWith(
            'mpv-1',
            '16:9'
        );
        expect(started).toEqual({ active: true, targetPath: '/tmp/rec.ts' });
        expect(stopped).toEqual({ active: false });
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
        // Relative: the delta goes to mpv as-is, never a snapshot-derived
        // absolute target.
        expect(electron.seekEmbeddedMpvBy).toHaveBeenCalledWith('mpv-1', -30);
        expect(electron.seekEmbeddedMpv).not.toHaveBeenCalled();
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

/**
 * Advance the fake clock by one drain round: flush pending microtasks (the IPC
 * promises the startup chain awaits), then run every timer now due — which is
 * how the rAF shim's continuations get to run.
 *
 * One millisecond, never zero: a zero-delay timer scheduled from *inside* a
 * timer callback is clamped to the next millisecond, and `waitForStartupPaint`
 * nests exactly that way (rAF inside rAF). Advancing by 0 fires the outer hop
 * and strands the inner one forever.
 */
async function drainRound(): Promise<void> {
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1);
}

/**
 * Settle the controller's async startup chain, then assert.
 *
 * The bound is a number of drain rounds, not elapsed wall-clock time. Polling
 * real timers against a `Date.now()` deadline made these specs load-sensitive:
 * under parallel Jest workers the budget expired before the chain settled, so
 * a different pair of tests failed on each run. With the clock virtual the
 * spec imposes no deadline of its own — the rounds only ever advance when this
 * loop says so — so settling stops being a race against the machine. Jest's
 * own per-test timeout still applies, as it does to every spec.
 */
async function waitFor(
    condition: () => boolean,
    description: string
): Promise<void> {
    // Generous next to the ~4 rounds the longest chain needs, while still
    // failing fast (and reporting `description`) if it never settles.
    for (let round = 0; round < 100; round += 1) {
        if (condition()) {
            return;
        }
        await drainRound();
    }

    throw new Error(`Timed out waiting for ${description}`);
}

/**
 * Settle everything pending with no condition to poll for — used by the
 * negative assertions, where the point is that a late continuation runs and
 * still changes nothing.
 */
async function flush(): Promise<void> {
    for (let round = 0; round < 5; round += 1) {
        await drainRound();
    }
}
