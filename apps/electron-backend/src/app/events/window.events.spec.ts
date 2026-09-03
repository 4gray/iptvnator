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
        listenerCount(event: string): number {
            return listeners.get(event)?.size ?? 0;
        },
        close: jest.fn(),
    };
}

const fakeEvent = { sender: {} };

describe('WindowEvents', () => {
    beforeAll(async () => {
        await import('./window.events');
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

        // The first transition lands; the queued exit is still owed, so
        // the pending target stays until the window really reports it.
        win.state.fullScreen = true;
        win.emit('enter-full-screen');
        expect(win.listenerCount('leave-full-screen')).toBe(1);

        win.state.fullScreen = false;
        win.emit('leave-full-screen');
        expect(win.listenerCount('enter-full-screen')).toBe(0);
        expect(win.listenerCount('leave-full-screen')).toBe(0);

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

        expect(win.listenerCount('enter-full-screen')).toBe(0);

        toggle(fakeEvent);
        expect(win.setFullScreen).toHaveBeenLastCalledWith(false);
    });

    it('lets the next press correct a request the platform dropped', () => {
        const win = createFakeWindow({ asyncFullScreen: true });
        mockFromWebContents.mockReturnValue(win);
        const toggle = mockHandlers.get('WINDOW:TOGGLE_FULLSCREEN')!;

        toggle(fakeEvent);
        toggle(fakeEvent);
        // The enter landed, but the queued exit never happened.
        win.state.fullScreen = true;
        win.emit('enter-full-screen');

        // Pending target is still "windowed": this press asks for
        // fullscreen, a no-op the window swallows …
        toggle(fakeEvent);
        expect(win.setFullScreen).toHaveBeenLastCalledWith(true);
        // … and the following press finally requests the exit.
        toggle(fakeEvent);
        expect(win.setFullScreen).toHaveBeenLastCalledWith(false);
        win.state.fullScreen = false;
        win.emit('leave-full-screen');
        expect(win.listenerCount('leave-full-screen')).toBe(0);
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
