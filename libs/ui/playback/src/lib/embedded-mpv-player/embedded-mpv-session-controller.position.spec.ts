import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

/**
 * An ancestor re-layout can translate the host element without resizing it
 * (sidebar content settling, panels loading below the player). ResizeObserver
 * reports size changes only and no resize/scroll event fires, so before the
 * position poll the native child window silently kept its stale coordinates
 * and rendered offset from the DOM stage (#1428). The controller now polls
 * the host bounds at a low frequency and re-syncs only when they drift from
 * the last synced bounds.
 */
describe('EmbeddedMpvSessionController position drift poll', () => {
    let electron: {
        platform: string;
        getEmbeddedMpvSupport: jest.Mock;
        prepareEmbeddedMpv: jest.Mock;
        createEmbeddedMpvSession: jest.Mock;
        loadEmbeddedMpvPlayback: jest.Mock;
        disposeEmbeddedMpvSession: jest.Mock;
        setEmbeddedMpvBounds: jest.Mock;
        onEmbeddedMpvSessionUpdate: jest.Mock;
    };

    beforeEach(() => {
        // See `waitFor`: the startup chain is drained on a virtual clock so a
        // loaded machine cannot change the outcome.
        jest.useFakeTimers();
        electron = {
            platform: 'linux',
            getEmbeddedMpvSupport: jest
                .fn()
                .mockResolvedValue({ supported: true, platform: 'linux' }),
            prepareEmbeddedMpv: jest
                .fn()
                .mockResolvedValue({ supported: true, platform: 'linux' }),
            createEmbeddedMpvSession: jest
                .fn()
                .mockResolvedValue(createSession()),
            loadEmbeddedMpvPlayback: jest.fn().mockResolvedValue(undefined),
            disposeEmbeddedMpvSession: jest.fn().mockResolvedValue(undefined),
            setEmbeddedMpvBounds: jest.fn().mockResolvedValue(undefined),
            onEmbeddedMpvSessionUpdate: jest.fn(() => jest.fn()),
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

    it('re-syncs when the host moves without resizing, and stays silent otherwise', async () => {
        const rect = { left: 10, top: 20, width: 640, height: 360 };
        const host = {
            getBoundingClientRect: () => ({ ...rect }),
        } as HTMLElement;

        const controller = TestBed.inject(EmbeddedMpvSessionController);
        const teardown = controller.startSession(host, createPlayback(), 0.5);
        await waitFor(
            () => controller.sessionId() === 'mpv-1',
            'session to start'
        );
        // The post-create catch-up sync records the initial bounds.
        await waitFor(
            () => electron.setEmbeddedMpvBounds.mock.calls.length > 0,
            'initial bounds sync'
        );
        electron.setEmbeddedMpvBounds.mockClear();

        // A stationary host must not produce any IPC across several ticks.
        await jest.advanceTimersByTimeAsync(2000);
        expect(electron.setEmbeddedMpvBounds).not.toHaveBeenCalled();

        // Position-only shift: getBoundingClientRect changes while nothing
        // fires ResizeObserver, window resize, or scroll.
        rect.left = 29;
        await jest.advanceTimersByTimeAsync(600);
        await waitFor(
            () => electron.setEmbeddedMpvBounds.mock.calls.length > 0,
            'bounds re-sync after position drift'
        );
        expect(electron.setEmbeddedMpvBounds).toHaveBeenLastCalledWith(
            'mpv-1',
            { x: 29, y: 20, width: 640, height: 360 }
        );

        // Once synced, the settled position produces no further IPC.
        electron.setEmbeddedMpvBounds.mockClear();
        await jest.advanceTimersByTimeAsync(2000);
        expect(electron.setEmbeddedMpvBounds).not.toHaveBeenCalled();

        // Teardown stops the poll: later drift must not reach the bridge.
        teardown();
        rect.left = 100;
        await jest.advanceTimersByTimeAsync(2000);
        expect(electron.setEmbeddedMpvBounds).not.toHaveBeenCalled();
    });
});

function createPlayback(): ResolvedPortalPlayback {
    return {
        streamUrl: 'https://example.com/movie.mp4',
        title: 'Example Movie',
    };
}

function createSession(): EmbeddedMpvSession {
    return {
        id: 'mpv-1',
        title: 'Example Movie',
        streamUrl: 'https://example.com/movie.mp4',
        status: 'playing',
        positionSeconds: 0,
        durationSeconds: null,
        volume: 0.5,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        recording: { active: false },
        startedAt: '2026-08-23T00:00:00.000Z',
        updatedAt: '2026-08-23T00:00:01.000Z',
    };
}

/**
 * Settle the controller's async startup chain on the fake clock, bounded by
 * drain rounds rather than wall-clock time — under parallel Jest workers a
 * real-timer deadline expired before the chain settled and failed at random.
 *
 * One millisecond per round, never zero: `waitForStartupPaint` nests rAF
 * inside rAF, and a zero-delay timer scheduled from inside a timer callback is
 * clamped to the next millisecond, so a 0ms advance strands the inner hop.
 */
async function waitFor(
    condition: () => boolean,
    description: string
): Promise<void> {
    for (let round = 0; round < 100; round += 1) {
        if (condition()) {
            return;
        }
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1);
    }
    throw new Error(`Timed out waiting for ${description}`);
}
