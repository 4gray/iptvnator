/**
 * Regression coverage for the WINDOW:STATE_CHANGED pushes that drive the
 * renderer-drawn window controls on Windows/Linux.
 *
 * The handlers must never re-read window state at event time: on Windows,
 * isFullScreen() can still report true while 'leave-full-screen' fires for
 * HTML-element fullscreen (video player) exits, and isMaximized() reports
 * false while the window is fullscreen. Polling pushed a stale
 * `isFullScreen: true` on exit — leaving the custom window controls hidden
 * forever — and cleared the companion `isMaximized`, sticking the
 * maximize/restore glyph on the wrong icon. Instead the state is seeded once
 * at attach time and each event patches only the flag it names.
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

    it('keeps the maximized flag across a fullscreen round-trip while the window misreports it', () => {
        const win = createMockStateWindow();
        win.isMaximized.mockReturnValue(true);
        attachWindowStateEvents(win);
        // Windows reports a fullscreen window as not maximized, so polling
        // the companion flag here would clear it and leave the glyph on
        // "maximize" after the controls come back.
        win.isMaximized.mockReturnValue(false);

        fireWindowEvent(win, 'enter-html-full-screen');
        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: true, isFullScreen: true }
        );

        fireWindowEvent(win, 'leave-html-full-screen');
        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: true, isFullScreen: false }
        );
    });

    it('keeps isFullScreen=true when the player leaves HTML fullscreen inside a natively fullscreen window', () => {
        const win = createMockStateWindow();
        // A fullscreen launch (or F11 before attach) — the window is
        // natively fullscreen when the events are wired up.
        win.isFullScreen.mockReturnValue(true);
        attachWindowStateEvents(win);

        // Electron sees the window is already fullscreen, so entering HTML
        // fullscreen only emits the html variant …
        fireWindowEvent(win, 'enter-html-full-screen');
        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: true }
        );

        // … and leaving it restores ONLY the HTML state: no
        // 'leave-full-screen' fires and the window stays fullscreen. A
        // single flag would un-hide the window controls here.
        fireWindowEvent(win, 'leave-html-full-screen');
        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: true }
        );

        // F11 afterwards is what actually leaves fullscreen.
        fireWindowEvent(win, 'leave-full-screen');
        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: false }
        );
    });

    it('keeps a native fullscreen entered by event across a player HTML fullscreen round-trip', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);

        fireWindowEvent(win, 'enter-full-screen');
        fireWindowEvent(win, 'enter-html-full-screen');
        fireWindowEvent(win, 'leave-html-full-screen');

        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: true }
        );
    });

    it('clears isFullScreen when both the native and the HTML state are left', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);

        // Windows/Linux HTML fullscreen without prior native fullscreen:
        // Electron toggles the native window too, so both pairs fire.
        fireWindowEvent(win, 'enter-full-screen');
        fireWindowEvent(win, 'enter-html-full-screen');
        fireWindowEvent(win, 'leave-full-screen');
        fireWindowEvent(win, 'leave-html-full-screen');

        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: false, isFullScreen: false }
        );
    });

    it('keeps the fullscreen flag when a maximize event arrives mid-transition', () => {
        const win = createMockStateWindow();
        win.isFullScreen.mockReturnValue(true);
        attachWindowStateEvents(win);
        win.isFullScreen.mockReturnValue(false);

        fireWindowEvent(win, 'maximize');

        expect(win.webContents.send).toHaveBeenLastCalledWith(
            WINDOW_STATE_CHANGED,
            { isMaximized: true, isFullScreen: true }
        );
    });

    it('sends an independent payload per push', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);

        fireWindowEvent(win, 'enter-full-screen');
        const firstPayload = win.webContents.send.mock.calls[0][1];
        fireWindowEvent(win, 'leave-full-screen');

        // The renderer must not see the earlier push mutate under it.
        expect(firstPayload).toEqual({
            isMaximized: false,
            isFullScreen: true,
        });
    });

    it('skips pushes for destroyed windows', () => {
        const win = createMockStateWindow();
        attachWindowStateEvents(win);
        win.isDestroyed.mockReturnValue(true);

        fireWindowEvent(win, 'leave-full-screen');

        expect(win.webContents.send).not.toHaveBeenCalled();
    });
});
