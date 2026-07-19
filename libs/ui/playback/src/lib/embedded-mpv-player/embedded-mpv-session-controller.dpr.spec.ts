import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

/**
 * Moving the window to a display with a different scale (or changing the
 * page zoom) rescales the CSS→native mapping the backend applies to bounds,
 * without necessarily resizing the host element. The controller watches
 * devicePixelRatio through a re-armed matchMedia query and re-syncs bounds
 * when it changes (#1145).
 */
describe('EmbeddedMpvSessionController devicePixelRatio watch', () => {
    class FakeMediaQueryList {
        private readonly listeners = new Set<() => void>();

        constructor(readonly media: string) {}

        addEventListener(_type: 'change', listener: () => void): void {
            this.listeners.add(listener);
        }

        removeEventListener(_type: 'change', listener: () => void): void {
            this.listeners.delete(listener);
        }

        fire(): void {
            for (const listener of [...this.listeners]) {
                listener();
            }
        }

        get listenerCount(): number {
            return this.listeners.size;
        }
    }

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
    let mediaQueries: FakeMediaQueryList[];

    beforeEach(() => {
        electron = {
            platform: 'win32',
            getEmbeddedMpvSupport: jest
                .fn()
                .mockResolvedValue({ supported: true, platform: 'win32' }),
            prepareEmbeddedMpv: jest
                .fn()
                .mockResolvedValue({ supported: true, platform: 'win32' }),
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

        mediaQueries = [];
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: (media: string) => {
                const query = new FakeMediaQueryList(media);
                mediaQueries.push(query);
                return query;
            },
        });
        Object.defineProperty(window, 'devicePixelRatio', {
            configurable: true,
            value: 1,
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
        delete (window as unknown as { matchMedia?: unknown }).matchMedia;
        jest.restoreAllMocks();
    });

    it('re-syncs bounds and re-arms the query when devicePixelRatio changes', async () => {
        const controller = TestBed.inject(EmbeddedMpvSessionController);
        const teardown = controller.startSession(
            createHost(),
            createPlayback(),
            0.5
        );
        await waitFor(
            () => controller.sessionId() === 'mpv-1',
            'session to start'
        );

        expect(mediaQueries.length).toBe(1);
        expect(mediaQueries[0].media).toBe('(resolution: 1dppx)');
        electron.setEmbeddedMpvBounds.mockClear();

        // Simulate a move to a 150%-scaled display.
        Object.defineProperty(window, 'devicePixelRatio', {
            configurable: true,
            value: 1.5,
        });
        mediaQueries[0].fire();
        await waitFor(
            () => electron.setEmbeddedMpvBounds.mock.calls.length > 0,
            'bounds re-sync after dPR change'
        );

        // The stale query is released and a new one tracks the new ratio.
        expect(mediaQueries[0].listenerCount).toBe(0);
        expect(mediaQueries.length).toBe(2);
        expect(mediaQueries[1].media).toBe('(resolution: 1.5dppx)');

        // A second display change must fire through the re-armed query.
        electron.setEmbeddedMpvBounds.mockClear();
        mediaQueries[1].fire();
        await waitFor(
            () => electron.setEmbeddedMpvBounds.mock.calls.length > 0,
            'bounds re-sync after second dPR change'
        );

        teardown();
        expect(mediaQueries[mediaQueries.length - 1].listenerCount).toBe(0);
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
        startedAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:01.000Z',
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
