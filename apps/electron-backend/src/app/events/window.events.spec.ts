const mockHandlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
>();
const mockFromWebContents = jest.fn();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(
            (
                channel: string,
                handler: (event: unknown, ...args: unknown[]) => unknown
            ) => {
                mockHandlers.set(channel, handler);
            }
        ),
    },
    BrowserWindow: {
        fromWebContents: (...args: unknown[]) => mockFromWebContents(...args),
    },
}));

function createFakeWindow(
    initial: {
        maximized?: boolean;
        fullScreen?: boolean;
        /**
         * Windows/Linux flip isFullScreen() inside setFullScreen(); macOS
         * animates and reports the old value until the transition lands,
         * which the test then signals through `emit`.
         */
        asyncFullScreen?: boolean;
    } = {}
) {
    const state = {
        maximized: initial.maximized ?? false,
        fullScreen: initial.fullScreen ?? false,
    };
    const listeners = new Map<string, Set<() => void>>();

    return {
        state,
        isDestroyed: jest.fn(() => false),
        isMaximized: jest.fn(() => state.maximized),
        isFullScreen: jest.fn(() => state.fullScreen),
        minimize: jest.fn(),
        maximize: jest.fn(() => {
            state.maximized = true;
        }),
        unmaximize: jest.fn(() => {
            state.maximized = false;
        }),
        setFullScreen: jest.fn((fullScreen: boolean) => {
            if (!initial.asyncFullScreen) {
                state.fullScreen = fullScreen;
            }
        }),
        on: jest.fn((event: string, listener: () => void) => {
            listeners.set(
                event,
                (listeners.get(event) ?? new Set()).add(listener)
            );
        }),
        off: jest.fn((event: string, listener: () => void) => {
            listeners.get(event)?.delete(listener);
        }),
        emit(event: string): void {
            for (const listener of [...(listeners.get(event) ?? [])]) {
                listener();
            }
        },
        close: jest.fn(),
    };
}

const fakeEvent = { sender: {} };

describe('WindowEvents', () => {
    let transitionTimeoutMs: number;

    beforeAll(async () => {
        // Imported lazily so the hoisted electron mock can reference the
        // handler map declared above.
        ({ FULLSCREEN_TRANSITION_TIMEOUT_MS: transitionTimeoutMs } =
            await import('./window.events'));
    });

    beforeEach(() => {
        mockFromWebContents.mockReset();
    });

    it('registers handlers for all window control channels', () => {
        expect([...mockHandlers.keys()].sort()).toEqual([
            'WINDOW:CLOSE',
            'WINDOW:GET_STATE',
            'WINDOW:MINIMIZE',
            'WINDOW:TOGGLE_FULLSCREEN',
            'WINDOW:TOGGLE_MAXIMIZE',
        ]);
    });

    it('minimizes the sender window', () => {
        const win = createFakeWindow();
        mockFromWebContents.mockReturnValue(win);

        mockHandlers.get('WINDOW:MINIMIZE')!(fakeEvent);

        expect(win.minimize).toHaveBeenCalledTimes(1);
    });

    it('maximizes an unmaximized window and returns the new state', () => {
        const win = createFakeWindow({ maximized: false });
        mockFromWebContents.mockReturnValue(win);

        const result = mockHandlers.get('WINDOW:TOGGLE_MAXIMIZE')!(fakeEvent);

        expect(win.maximize).toHaveBeenCalledTimes(1);
        expect(win.unmaximize).not.toHaveBeenCalled();
        expect(result).toEqual({ isMaximized: true, isFullScreen: false });
    });

    it('unmaximizes a maximized window and returns the new state', () => {
        const win = createFakeWindow({ maximized: true });
        mockFromWebContents.mockReturnValue(win);

        const result = mockHandlers.get('WINDOW:TOGGLE_MAXIMIZE')!(fakeEvent);

        expect(win.unmaximize).toHaveBeenCalledTimes(1);
        expect(win.maximize).not.toHaveBeenCalled();
        expect(result).toEqual({ isMaximized: false, isFullScreen: false });
    });

    it('enters fullscreen from a windowed state and reports the requested state', () => {
        const win = createFakeWindow({ maximized: true, fullScreen: false });
        mockFromWebContents.mockReturnValue(win);

        const result = mockHandlers.get('WINDOW:TOGGLE_FULLSCREEN')!(fakeEvent);

        expect(win.setFullScreen).toHaveBeenCalledWith(true);
        expect(result).toEqual({ isMaximized: true, isFullScreen: true });
    });

    it('leaves fullscreen and reports the requested state', () => {
        const win = createFakeWindow({ fullScreen: true });
        mockFromWebContents.mockReturnValue(win);

        const result = mockHandlers.get('WINDOW:TOGGLE_FULLSCREEN')!(fakeEvent);

        expect(win.setFullScreen).toHaveBeenCalledWith(false);
        expect(result).toEqual({ isMaximized: false, isFullScreen: false });
    });

    it('keeps toggle parity when a second press arrives before the transition lands', () => {
        const win = createFakeWindow({ asyncFullScreen: true });
        mockFromWebContents.mockReturnValue(win);
        const toggle = mockHandlers.get('WINDOW:TOGGLE_FULLSCREEN')!;

        toggle(fakeEvent);
        // Still animating: the window reports the old state.
        expect(win.isFullScreen()).toBe(false);

        const second = toggle(fakeEvent);

        // Decided against the pending target, not the stale getter.
        expect(win.setFullScreen.mock.calls).toEqual([[true], [false]]);
        expect(second).toEqual({ isMaximized: false, isFullScreen: false });

        // The first transition lands on the other state: the exit is
        // re-issued rather than trusted to a platform queue.
        win.state.fullScreen = true;
        win.emit('enter-full-screen');
        expect(win.setFullScreen.mock.calls).toEqual([
            [true],
            [false],
            [false],
        ]);

        win.state.fullScreen = false;
        win.emit('leave-full-screen');

        // Back to deciding from the live state.
        toggle(fakeEvent);
        expect(win.setFullScreen).toHaveBeenLastCalledWith(true);
    });

    it('stops tracking once the transition reports the requested state', () => {
        const win = createFakeWindow({ asyncFullScreen: true });
        mockFromWebContents.mockReturnValue(win);
        const toggle = mockHandlers.get('WINDOW:TOGGLE_FULLSCREEN')!;

        toggle(fakeEvent);
        win.state.fullScreen = true;
        win.emit('enter-full-screen');
        // Reported the requested state: nothing re-issued.
        expect(win.setFullScreen).toHaveBeenCalledTimes(1);

        toggle(fakeEvent);
        expect(win.setFullScreen).toHaveBeenLastCalledWith(false);
    });

    it('forgets a request that never reports back after the transition timeout', () => {
        const win = createFakeWindow({ asyncFullScreen: true });
        mockFromWebContents.mockReturnValue(win);
        const toggle = mockHandlers.get('WINDOW:TOGGLE_FULLSCREEN')!;
        const now = jest.spyOn(Date, 'now');

        try {
            now.mockReturnValue(1_000);
            toggle(fakeEvent);
            expect(win.setFullScreen).toHaveBeenLastCalledWith(true);

            // No event ever arrived: the window really is still windowed,
            // so the stale target must not flip this press into an exit.
            now.mockReturnValue(1_000 + transitionTimeoutMs + 1);
            toggle(fakeEvent);
            expect(win.setFullScreen).toHaveBeenLastCalledWith(true);
        } finally {
            now.mockRestore();
        }
    });

    it('decides a press during a re-issued transition against the re-issued target', () => {
        const win = createFakeWindow({ asyncFullScreen: true });
        mockFromWebContents.mockReturnValue(win);
        const toggle = mockHandlers.get('WINDOW:TOGGLE_FULLSCREEN')!;

        toggle(fakeEvent);
        toggle(fakeEvent);
        // The enter landed; the exit is re-issued and now in flight.
        win.state.fullScreen = true;
        win.emit('enter-full-screen');
        expect(win.setFullScreen).toHaveBeenLastCalledWith(false);

        // A press before that exit lands is decided against the re-issued
        // target, so the window is asked back into fullscreen.
        toggle(fakeEvent);
        expect(win.setFullScreen).toHaveBeenLastCalledWith(true);

        win.state.fullScreen = false;
        win.emit('leave-full-screen');
        // Landed on the other state again: the enter is re-issued.
        expect(win.setFullScreen.mock.calls.slice(-2)).toEqual([
            [true],
            [true],
        ]);
    });

    it('closes the sender window', () => {
        const win = createFakeWindow();
        mockFromWebContents.mockReturnValue(win);

        mockHandlers.get('WINDOW:CLOSE')!(fakeEvent);

        expect(win.close).toHaveBeenCalledTimes(1);
    });

    it('returns the current window state', () => {
        const win = createFakeWindow({ maximized: true, fullScreen: true });
        mockFromWebContents.mockReturnValue(win);

        const result = mockHandlers.get('WINDOW:GET_STATE')!(fakeEvent);

        expect(result).toEqual({ isMaximized: true, isFullScreen: true });
    });

    it('is a safe no-op when the sender has no window', () => {
        mockFromWebContents.mockReturnValue(null);

        expect(() =>
            mockHandlers.get('WINDOW:MINIMIZE')!(fakeEvent)
        ).not.toThrow();
        expect(mockHandlers.get('WINDOW:TOGGLE_MAXIMIZE')!(fakeEvent)).toEqual({
            isMaximized: false,
            isFullScreen: false,
        });
        expect(
            mockHandlers.get('WINDOW:TOGGLE_FULLSCREEN')!(fakeEvent)
        ).toEqual({
            isMaximized: false,
            isFullScreen: false,
        });
        expect(mockHandlers.get('WINDOW:GET_STATE')!(fakeEvent)).toEqual({
            isMaximized: false,
            isFullScreen: false,
        });
    });

    it('treats a destroyed window like a missing window', () => {
        const win = createFakeWindow();
        win.isDestroyed.mockReturnValue(true);
        mockFromWebContents.mockReturnValue(win);

        mockHandlers.get('WINDOW:MINIMIZE')!(fakeEvent);

        expect(win.minimize).not.toHaveBeenCalled();
    });
});
