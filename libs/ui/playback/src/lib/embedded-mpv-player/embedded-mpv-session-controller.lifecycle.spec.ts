import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvEngine,
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

describe('EmbeddedMpvSessionController (lifecycle & support edges)', () => {
    let electron: {
        platform: string;
        getEmbeddedMpvSupport: jest.Mock;
        prepareEmbeddedMpv: jest.Mock;
        createEmbeddedMpvSession: jest.Mock;
        loadEmbeddedMpvPlayback: jest.Mock;
        attachEmbeddedMpvFrameView: jest.Mock;
        detachEmbeddedMpvFrameView: jest.Mock;
        disposeEmbeddedMpvSession: jest.Mock;
        setEmbeddedMpvBounds: jest.Mock;
        onEmbeddedMpvSessionUpdate: jest.Mock;
    };

    const setBridge = (value: unknown) =>
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value,
        });

    beforeEach(() => {
        electron = {
            platform: 'darwin',
            getEmbeddedMpvSupport: jest
                .fn()
                .mockResolvedValue({ supported: true, platform: 'darwin' }),
            prepareEmbeddedMpv: jest
                .fn()
                .mockResolvedValue({ supported: true, platform: 'darwin' }),
            createEmbeddedMpvSession: jest
                .fn()
                .mockResolvedValue(createSession({ id: 'mpv-1' })),
            loadEmbeddedMpvPlayback: jest.fn().mockResolvedValue(undefined),
            attachEmbeddedMpvFrameView: jest.fn().mockResolvedValue(true),
            detachEmbeddedMpvFrameView: jest.fn(),
            disposeEmbeddedMpvSession: jest.fn().mockResolvedValue(undefined),
            setEmbeddedMpvBounds: jest.fn().mockResolvedValue(undefined),
            onEmbeddedMpvSessionUpdate: jest.fn(() => jest.fn()),
        };
        setBridge(electron);
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: class MockResizeObserver {
                observe = jest.fn();
                disconnect = jest.fn();
            },
        });
        Object.defineProperty(window, 'requestAnimationFrame', {
            configurable: true,
            value: (callback: FrameRequestCallback) =>
                window.setTimeout(() => callback(0), 0),
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
        TestBed.resetTestingModule();
        delete (window as unknown as { electron?: unknown }).electron;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('reports unsupported outside the Electron desktop build', () => {
        setBridge(undefined);
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        expect(controller.support()).toEqual({
            supported: false,
            platform: 'unknown',
            reason: 'Embedded MPV requires the Electron desktop build.',
        });
    });

    it('maps a support-probe failure onto an unsupported result', async () => {
        electron.getEmbeddedMpvSupport.mockRejectedValueOnce(
            new Error('addon load failed')
        );
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        await waitFor(
            () => controller.support() !== null,
            'support fallback to be set'
        );
        expect(controller.support()).toEqual({
            supported: false,
            platform: 'darwin',
            reason: 'addon load failed',
        });
    });

    it('preserves the constructor support probe after preparing a session', async () => {
        const probedSupport = createSupport('native');
        const preparedSupport = createSupport('frame-copy');
        electron.getEmbeddedMpvSupport.mockResolvedValueOnce(probedSupport);
        electron.prepareEmbeddedMpv.mockResolvedValueOnce(preparedSupport);
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        await waitFor(
            () => controller.support() === probedSupport,
            'constructor support probe to resolve'
        );
        const teardown = controller.startSession(
            createHost(),
            createPlayback(),
            0.5
        );

        try {
            await waitFor(
                () => electron.loadEmbeddedMpvPlayback.mock.calls.length > 0,
                'playback load to start'
            );

            expect(controller.support()).toBe(probedSupport);
            expect(electron.createEmbeddedMpvSession).toHaveBeenCalled();
            expect(electron.loadEmbeddedMpvPlayback).toHaveBeenCalled();
        } finally {
            teardown();
        }
    });

    it('sets an error session when prepare reports unsupported', async () => {
        electron.prepareEmbeddedMpv.mockResolvedValueOnce({
            supported: false,
            platform: 'darwin',
            reason: 'libmpv not found',
        });
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        controller.startSession(createHost(), createPlayback(), 0.5);
        await waitFor(
            () => controller.session()?.status === 'error',
            'error session to be set'
        );

        expect(controller.session()?.error).toBe('libmpv not found');
        expect(electron.createEmbeddedMpvSession).not.toHaveBeenCalled();
    });

    it('retry clears session state, stall flag, and bumps the retry token', () => {
        const controller = TestBed.inject(EmbeddedMpvSessionController);
        controller.sessionId.set('mpv-1');
        controller.session.set(createSession({ status: 'error' }));

        controller.retry();

        expect(controller.session()).toBeNull();
        expect(controller.sessionId()).toBeNull();
        expect(controller.stalled()).toBe(false);
        expect(controller.retryToken()).toBe(1);
    });

    it('flags a stalled session after 30s of loading and clears it on playback', async () => {
        const controller = TestBed.inject(EmbeddedMpvSessionController);
        jest.useFakeTimers();

        controller.session.set(createSession({ status: 'loading' }));
        TestBed.tick();
        jest.advanceTimersByTime(30_000);
        expect(controller.stalled()).toBe(true);

        controller.session.set(createSession({ status: 'playing' }));
        TestBed.tick();
        expect(controller.stalled()).toBe(false);
    });

    it('disposes a session whose creation resolves only after teardown', async () => {
        let resolveCreate: ((session: EmbeddedMpvSession) => void) | null =
            null;
        electron.createEmbeddedMpvSession.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveCreate = resolve;
                })
        );
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        const teardown = controller.startSession(
            createHost(),
            createPlayback(),
            0.5
        );
        await waitFor(
            () => resolveCreate !== null,
            'startup to reach createEmbeddedMpvSession'
        );
        teardown();

        resolveCreate?.(createSession({ id: 'mpv-late' }));
        await waitFor(
            () => electron.disposeEmbeddedMpvSession.mock.calls.length > 0,
            'late session to be disposed'
        );

        expect(electron.disposeEmbeddedMpvSession).toHaveBeenCalledWith(
            'mpv-late'
        );
        expect(controller.sessionId()).toBeNull();
        expect(electron.loadEmbeddedMpvPlayback).not.toHaveBeenCalled();
    });

    it('does not continue frame setup when teardown happens during playback load', async () => {
        const frameCopySupport = createSupport('frame-copy');
        let resolveLoad: (() => void) | null = null;
        electron.getEmbeddedMpvSupport.mockResolvedValueOnce(frameCopySupport);
        electron.prepareEmbeddedMpv.mockResolvedValueOnce(frameCopySupport);
        electron.loadEmbeddedMpvPlayback.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveLoad = resolve;
                })
        );
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        await waitFor(
            () => controller.support() === frameCopySupport,
            'frame-copy support probe to resolve'
        );
        const teardown = controller.startSession(
            createHost(),
            createPlayback(),
            0.5
        );
        await waitFor(
            () => electron.loadEmbeddedMpvPlayback.mock.calls.length > 0,
            'playback load to start'
        );

        teardown();
        resolveLoad?.();
        await Promise.resolve();
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(electron.attachEmbeddedMpvFrameView).not.toHaveBeenCalled();
        expect(controller.session()).toBeNull();
        expect(controller.sessionId()).toBeNull();
        expect(electron.disposeEmbeddedMpvSession).toHaveBeenCalledWith(
            'mpv-1'
        );
        expect(electron.detachEmbeddedMpvFrameView).toHaveBeenCalled();
    });

    it('does not schedule bounds after teardown during frame view attachment', async () => {
        const frameCopySupport = createSupport('frame-copy');
        let resolveAttach: ((attached: boolean) => void) | null = null;
        electron.getEmbeddedMpvSupport.mockResolvedValueOnce(frameCopySupport);
        electron.prepareEmbeddedMpv.mockResolvedValueOnce(frameCopySupport);
        electron.attachEmbeddedMpvFrameView.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveAttach = resolve;
                })
        );
        const controller = TestBed.inject(EmbeddedMpvSessionController);

        await waitFor(
            () => controller.support() === frameCopySupport,
            'frame-copy support probe to resolve'
        );
        const teardown = controller.startSession(
            createHost(),
            createPlayback(),
            0.5
        );
        await waitFor(
            () => electron.attachEmbeddedMpvFrameView.mock.calls.length > 0,
            'frame view attachment to start'
        );

        teardown();
        const requestAnimationFrame = jest.spyOn(
            window,
            'requestAnimationFrame'
        );
        resolveAttach?.(true);
        await Promise.resolve();
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(controller.session()).toBeNull();
        expect(controller.sessionId()).toBeNull();
        expect(electron.disposeEmbeddedMpvSession).toHaveBeenCalledWith(
            'mpv-1'
        );
        expect(electron.detachEmbeddedMpvFrameView).toHaveBeenCalledTimes(1);
    });

    it('syncs bounds through a custom provider on triggerBoundsSync', async () => {
        const controller = TestBed.inject(EmbeddedMpvSessionController);
        controller.setBoundsProvider(() => ({
            x: 1,
            y: 2,
            width: 300,
            height: 200,
        }));

        controller.startSession(createHost(), createPlayback(), 0.5);
        await waitFor(
            () => controller.sessionId() === 'mpv-1',
            'session to start'
        );
        electron.setEmbeddedMpvBounds.mockClear();

        controller.triggerBoundsSync();
        await waitFor(
            () => electron.setEmbeddedMpvBounds.mock.calls.length > 0,
            'bounds sync to run'
        );

        expect(electron.setEmbeddedMpvBounds).toHaveBeenCalledWith('mpv-1', {
            x: 1,
            y: 2,
            width: 300,
            height: 200,
        });
    });
});

function createHost(): HTMLElement {
    return {
        getBoundingClientRect: () => ({
            left: 10,
            top: 20,
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

function createSupport(engine: EmbeddedMpvEngine) {
    return { supported: true, platform: 'darwin', engine };
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
