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

const mockApp = { mainWindow: null as unknown };
jest.mock('../app', () => ({
    __esModule: true,
    default: mockApp,
}));

function createFakeWindow(
    initial: { maximized?: boolean; fullScreen?: boolean } = {}
) {
    const state = {
        maximized: initial.maximized ?? false,
        fullScreen: initial.fullScreen ?? false,
    };

    return {
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
            'WINDOW:SET_FULLSCREEN',
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
        expect(mockHandlers.get('WINDOW:GET_STATE')!(fakeEvent)).toEqual({
            isMaximized: false,
            isFullScreen: false,
        });
    });

    it('toggles real native fullscreen on the sender window', () => {
        const win = createFakeWindow() as ReturnType<typeof createFakeWindow> & {
            setFullScreen: jest.Mock;
        };
        win.setFullScreen = jest.fn();
        mockFromWebContents.mockReturnValue(win);

        mockHandlers.get('WINDOW:SET_FULLSCREEN')!(fakeEvent, true);
        expect(win.setFullScreen).toHaveBeenCalledWith(true);

        mockHandlers.get('WINDOW:SET_FULLSCREEN')!(fakeEvent, false);
        expect(win.setFullScreen).toHaveBeenLastCalledWith(false);
    });

    it('is a safe no-op when the sender window is destroyed', () => {
        const win = createFakeWindow() as ReturnType<typeof createFakeWindow> & {
            setFullScreen: jest.Mock;
        };
        win.setFullScreen = jest.fn();
        win.isDestroyed.mockReturnValue(true);
        mockFromWebContents.mockReturnValue(win);

        expect(() =>
            mockHandlers.get('WINDOW:SET_FULLSCREEN')!(fakeEvent, true)
        ).not.toThrow();
        expect(win.setFullScreen).not.toHaveBeenCalled();
    });

    it('treats a destroyed window like a missing window', () => {
        const win = createFakeWindow();
        win.isDestroyed.mockReturnValue(true);
        mockFromWebContents.mockReturnValue(win);

        mockHandlers.get('WINDOW:MINIMIZE')!(fakeEvent);

        expect(win.minimize).not.toHaveBeenCalled();
    });
});
