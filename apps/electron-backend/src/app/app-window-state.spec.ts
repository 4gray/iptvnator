/**
 * Regression coverage for the WINDOW:STATE_CHANGED pushes that drive the
 * renderer-drawn window controls on Windows/Linux.
 *
 * The handlers must derive the flag their event names from the event itself
 * instead of re-reading it from the window: on Windows, isFullScreen() can
 * still report true while 'leave-full-screen' fires for HTML-element
 * fullscreen (video player) exits. Polling at event time pushed a stale
 * `isFullScreen: true` on exit, and since no later event corrected it the
 * custom window controls stayed hidden forever.
 */

jest.mock('electron', () => ({
    app: {
        getPath: jest.fn(() => '/tmp'),
        isPackaged: false,
        isReady: jest.fn(() => false),
        on: jest.fn(),
    },
    BrowserWindow: jest.fn(),
    Menu: {
        buildFromTemplate: jest.fn(),
    },
    screen: {
        getPrimaryDisplay: jest.fn(),
    },
    session: {
        defaultSession: {
            clearStorageData: jest.fn(),
        },
    },
    shell: {
        openExternal: jest.fn(),
    },
}));

jest.mock('./services/store.service', () => ({
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
    WINDOW_BOUNDS: 'windowBounds',
}));

import { WINDOW_STATE_CHANGED } from '@iptvnator/shared/interfaces';
import App from './app';

type MockStateWindow = {
    isDestroyed: jest.Mock<boolean, []>;
    isFullScreen: jest.Mock<boolean, []>;
    isMaximized: jest.Mock<boolean, []>;
    on: jest.Mock<void, [string, () => void]>;
    webContents: {
        send: jest.Mock<void, [string, unknown]>;
    };
};

function createMockStateWindow(): MockStateWindow {
    return {
        isDestroyed: jest.fn<boolean, []>().mockReturnValue(false),
        isFullScreen: jest.fn<boolean, []>().mockReturnValue(false),
        isMaximized: jest.fn<boolean, []>().mockReturnValue(false),
        on: jest.fn<void, [string, () => void]>(),
        webContents: {
            send: jest.fn<void, [string, unknown]>(),
        },
    };
}

function attachWindowStateEvents(win: MockStateWindow): void {
    (
        App as unknown as {
            attachWindowStateEvents: (win: MockStateWindow) => void;
        }
    ).attachWindowStateEvents(win);
}

function fireWindowEvent(win: MockStateWindow, eventName: string): void {
    const handlers = win.on.mock.calls
        .filter(([name]) => name === eventName)
        .map(([, handler]) => handler);

    expect(handlers).toHaveLength(1);
    handlers[0]();
}

describe('window state change pushes', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        'platform'
    );

    function setProcessPlatform(platform: NodeJS.Platform): void {
        Object.defineProperty(process, 'platform', {
            configurable: true,
            value: platform,
        });
    }

    beforeEach(() => {
        setProcessPlatform('win32');
    });

    afterEach(() => {
        if (originalPlatform) {
            Object.defineProperty(process, 'platform', originalPlatform);
        }
    });

    it('registers no window-state listeners on macOS', () => {
        setProcessPlatform('darwin');
        const win = createMockStateWindow();

        attachWindowStateEvents(win);

        expect(win.on).not.toHaveBeenCalled();
    });

    it('pushes isFullScreen=false on leave-full-screen even while the window still reports fullscreen', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);
        // Windows still reports the old state while the transition runs.
        win.isFullScreen.mockReturnValue(true);

        fireWindowEvent(win, 'leave-full-screen');

        expect(win.webContents.send).toHaveBeenCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: false }
        );
    });

    it('pushes isFullScreen=false on leave-html-full-screen even while the window still reports fullscreen', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);
        win.isFullScreen.mockReturnValue(true);

        fireWindowEvent(win, 'leave-html-full-screen');

        expect(win.webContents.send).toHaveBeenCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: false }
        );
    });

    it('pushes isFullScreen=true on enter events before the window reports fullscreen', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);
        win.isFullScreen.mockReturnValue(false);

        fireWindowEvent(win, 'enter-full-screen');
        fireWindowEvent(win, 'enter-html-full-screen');

        expect(win.webContents.send).toHaveBeenCalledTimes(2);
        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: true }
        );
    });

    it('derives isMaximized from the maximize/unmaximize events instead of polling', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);

        win.isMaximized.mockReturnValue(false);
        fireWindowEvent(win, 'maximize');
        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: true, isFullScreen: false }
        );

        win.isMaximized.mockReturnValue(true);
        fireWindowEvent(win, 'unmaximize');
        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: false }
        );
    });

    it('skips pushes for destroyed windows', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);
        win.isDestroyed.mockReturnValue(true);

        fireWindowEvent(win, 'leave-full-screen');

        expect(win.webContents.send).not.toHaveBeenCalled();
    });
});
