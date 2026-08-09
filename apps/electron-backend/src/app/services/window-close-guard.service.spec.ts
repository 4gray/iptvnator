/**
 * Regression coverage for the unsaved-settings close guard: while the
 * renderer arms it, window close and app quit must be intercepted and
 * replayed only after the renderer confirms — and the interception must
 * never survive a renderer that can no longer answer (navigation, crash,
 * destroyed webContents), or the window would become unclosable.
 */

jest.mock('electron', () => ({
    app: {
        on: jest.fn(),
        quit: jest.fn(),
    },
    ipcMain: {
        handle: jest.fn(),
    },
}));

import { ipcMain } from 'electron';
import {
    WINDOW_CANCEL_CLOSE,
    WINDOW_CLOSE_REQUESTED,
    WINDOW_CONFIRM_CLOSE,
    WINDOW_SET_CLOSE_GUARD,
} from '@iptvnator/shared/interfaces';
import {
    bootstrapWindowCloseGuard,
    CloseGuardApp,
    CloseGuardWindow,
    WindowCloseGuard,
} from './window-close-guard.service';

type Listener = (...args: unknown[]) => void;

interface FakeApp extends CloseGuardApp {
    quit: jest.Mock;
    fireBeforeQuit(): void;
}

function createFakeApp(): FakeApp {
    const beforeQuitListeners: Listener[] = [];

    return {
        on: jest.fn((event: string, listener: Listener) => {
            if (event === 'before-quit') {
                beforeQuitListeners.push(listener);
            }
        }),
        quit: jest.fn(),
        fireBeforeQuit(): void {
            beforeQuitListeners.forEach((listener) => listener());
        },
    };
}

interface FakeWindow extends CloseGuardWindow {
    close: jest.Mock;
    isDestroyed: jest.Mock;
    webContents: CloseGuardWindow['webContents'] & {
        isDestroyed: jest.Mock;
        send: jest.Mock;
    };
    /** Fires the window 'close' event; returns whether it was prevented. */
    fireClose(): boolean;
    fireClosed(): void;
    fireWebContentsEvent(event: string): void;
}

function createFakeWindow(): FakeWindow {
    const windowListeners = new Map<string, Listener[]>();
    const webContentsListeners = new Map<string, Listener[]>();

    const addListener =
        (target: Map<string, Listener[]>) =>
        (event: string, listener: Listener) => {
            target.set(event, [...(target.get(event) ?? []), listener]);
        };

    return {
        close: jest.fn(),
        isDestroyed: jest.fn(() => false),
        on: jest.fn(addListener(windowListeners)),
        webContents: {
            isDestroyed: jest.fn(() => false),
            send: jest.fn(),
            on: jest.fn(addListener(webContentsListeners)),
        },
        fireClose(): boolean {
            let prevented = false;
            const event = {
                preventDefault: () => {
                    prevented = true;
                },
            };

            (windowListeners.get('close') ?? []).forEach((listener) =>
                listener(event)
            );
            return prevented;
        },
        fireClosed(): void {
            (windowListeners.get('closed') ?? []).forEach((listener) =>
                listener()
            );
        },
        fireWebContentsEvent(event: string): void {
            (webContentsListeners.get(event) ?? []).forEach((listener) =>
                listener()
            );
        },
    };
}

function createArmedGuard(): {
    app: FakeApp;
    guard: WindowCloseGuard;
    win: FakeWindow;
} {
    const app = createFakeApp();
    const guard = new WindowCloseGuard(app);
    const win = createFakeWindow();

    guard.trackQuitLifecycle();
    guard.attachToWindow(win);
    guard.setGuardActive(true);

    return { app, guard, win };
}

describe('WindowCloseGuard', () => {
    it('lets the window close while the guard is inactive', () => {
        const app = createFakeApp();
        const guard = new WindowCloseGuard(app);
        const win = createFakeWindow();

        guard.trackQuitLifecycle();
        guard.attachToWindow(win);

        expect(win.fireClose()).toBe(false);
        expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('intercepts an armed close and asks the renderer instead', () => {
        const { win } = createArmedGuard();

        expect(win.fireClose()).toBe(true);
        expect(win.webContents.send).toHaveBeenCalledWith(
            WINDOW_CLOSE_REQUESTED
        );
        expect(win.close).not.toHaveBeenCalled();
    });

    it('replays an intercepted window close once the renderer confirms', () => {
        const { app, guard, win } = createArmedGuard();

        win.fireClose();
        guard.confirmClose();

        expect(win.close).toHaveBeenCalledTimes(1);
        expect(app.quit).not.toHaveBeenCalled();
        // The replayed close must pass through even though the guard is
        // still armed — the renderer already decided.
        expect(win.fireClose()).toBe(false);
    });

    it('resumes a quit as a quit, not as a plain window close', () => {
        const { app, guard, win } = createArmedGuard();

        app.fireBeforeQuit();
        expect(win.fireClose()).toBe(true);

        guard.confirmClose();

        expect(app.quit).toHaveBeenCalledTimes(1);
        expect(win.close).not.toHaveBeenCalled();
    });

    it('forgets a cancelled quit before the next close attempt', () => {
        const { app, guard, win } = createArmedGuard();

        // Quit intercepted, user stays: the renderer cancels the request.
        app.fireBeforeQuit();
        win.fireClose();
        guard.cancelClose();

        // A later plain window close must not resurrect the quit.
        win.fireClose();
        guard.confirmClose();

        expect(win.close).toHaveBeenCalledTimes(1);
        expect(app.quit).not.toHaveBeenCalled();
    });

    it('keeps a pending quit when close is clicked again before the user decides', () => {
        const { app, guard, win } = createArmedGuard();

        // Cmd+Q intercepted; the dialog is open. An impatient second click
        // on the window's close button must not downgrade the quit — saving
        // would then close only the window and leave the app running.
        app.fireBeforeQuit();
        win.fireClose();
        win.fireClose();

        guard.confirmClose();

        expect(app.quit).toHaveBeenCalledTimes(1);
        expect(win.close).not.toHaveBeenCalled();
    });

    it('escalates a pending close to a quit when the user quits mid-decision', () => {
        const { app, guard, win } = createArmedGuard();

        win.fireClose();
        app.fireBeforeQuit();
        win.fireClose();

        guard.confirmClose();

        expect(app.quit).toHaveBeenCalledTimes(1);
        expect(win.close).not.toHaveBeenCalled();
    });

    it('lets exactly one close through after allowNextClose', () => {
        const { guard, win } = createArmedGuard();

        guard.allowNextClose();

        expect(win.fireClose()).toBe(false);
        // The bypass is consumed: the guard is back for the next attempt.
        expect(win.fireClose()).toBe(true);
    });

    it('confirms as a plain close when nothing was intercepted', () => {
        const { app, guard, win } = createArmedGuard();

        guard.confirmClose();

        expect(win.close).toHaveBeenCalledTimes(1);
        expect(app.quit).not.toHaveBeenCalled();
    });

    it('disarms when the renderer navigates away', () => {
        const { win } = createArmedGuard();

        win.fireWebContentsEvent('did-navigate');

        expect(win.fireClose()).toBe(false);
    });

    it('drops an unanswered quit intent when the renderer navigates away', () => {
        const { app, guard, win } = createArmedGuard();

        app.fireBeforeQuit();
        win.fireClose();
        win.fireWebContentsEvent('did-navigate');

        // A fresh interception cycle must not inherit the stale quit.
        guard.setGuardActive(true);
        win.fireClose();
        guard.confirmClose();

        expect(win.close).toHaveBeenCalledTimes(1);
        expect(app.quit).not.toHaveBeenCalled();
    });

    it('disarms when the render process is gone', () => {
        const { win } = createArmedGuard();

        win.fireWebContentsEvent('render-process-gone');

        expect(win.fireClose()).toBe(false);
    });

    it('never blocks a close whose webContents is already destroyed', () => {
        const { win } = createArmedGuard();

        win.webContents.isDestroyed.mockReturnValue(true);

        expect(win.fireClose()).toBe(false);
    });

    it('drops all state once the window is closed', () => {
        const { guard, win } = createArmedGuard();

        win.fireClose();
        win.fireClosed();
        guard.confirmClose();

        expect(win.close).not.toHaveBeenCalled();
    });

    it('ignores confirmations for a destroyed window', () => {
        const { guard, win } = createArmedGuard();

        win.fireClose();
        win.isDestroyed.mockReturnValue(true);
        guard.confirmClose();

        expect(win.close).not.toHaveBeenCalled();
    });

    it('starts a re-created window with a disarmed guard', () => {
        const { guard } = createArmedGuard();
        const nextWin = createFakeWindow();

        guard.attachToWindow(nextWin);

        expect(nextWin.fireClose()).toBe(false);
    });
});

describe('bootstrapWindowCloseGuard', () => {
    beforeEach(() => {
        (ipcMain.handle as jest.Mock).mockClear();
    });

    function getIpcHandler(channel: string): Listener {
        const call = (ipcMain.handle as jest.Mock).mock.calls.find(
            ([registered]) => registered === channel
        );

        if (!call) {
            throw new Error(`No IPC handler registered for ${channel}`);
        }

        return call[1] as Listener;
    }

    it('wires the IPC handlers to the guard', () => {
        const attachListeners: Array<(win: Electron.BrowserWindow) => void> =
            [];

        bootstrapWindowCloseGuard((listener) =>
            attachListeners.push(listener)
        );

        const win = createFakeWindow();
        attachListeners.forEach((listener) =>
            listener(win as unknown as Electron.BrowserWindow)
        );

        getIpcHandler(WINDOW_SET_CLOSE_GUARD)({}, true);
        expect(win.fireClose()).toBe(true);

        getIpcHandler(WINDOW_CANCEL_CLOSE)({});

        getIpcHandler(WINDOW_CONFIRM_CLOSE)({});
        expect(win.close).toHaveBeenCalledTimes(1);
    });

    it('treats non-boolean guard payloads as disarm', () => {
        const attachListeners: Array<(win: Electron.BrowserWindow) => void> =
            [];

        bootstrapWindowCloseGuard((listener) =>
            attachListeners.push(listener)
        );

        const win = createFakeWindow();
        attachListeners.forEach((listener) =>
            listener(win as unknown as Electron.BrowserWindow)
        );

        getIpcHandler(WINDOW_SET_CLOSE_GUARD)({}, 'yes');

        expect(win.fireClose()).toBe(false);
    });
});
