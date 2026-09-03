/**
 * IPC handlers for the renderer-drawn window controls used with the custom
 * title bar on Windows/Linux (`titleBarStyle: 'hidden'`). Each handler
 * resolves the window from the calling WebContents so it works without
 * coupling to the static main-window reference.
 */

import { BrowserWindow, ipcMain } from 'electron';
import {
    WINDOW_CLOSE,
    WINDOW_GET_STATE,
    WINDOW_MINIMIZE,
    WINDOW_TOGGLE_FULLSCREEN,
    WINDOW_TOGGLE_MAXIMIZE,
} from '@iptvnator/shared/interfaces';

interface WindowState {
    isMaximized: boolean;
    isFullScreen: boolean;
}

function getSenderWindow(
    event: Electron.IpcMainInvokeEvent
): Electron.BrowserWindow | null {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && !win.isDestroyed() ? win : null;
}

function getWindowState(win: Electron.BrowserWindow | null): WindowState {
    return {
        isMaximized: !!win?.isMaximized(),
        isFullScreen: !!win?.isFullScreen(),
    };
}

export default class WindowEvents {
    static bootstrapWindowEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle(WINDOW_MINIMIZE, (event) => {
    getSenderWindow(event)?.minimize();
});

ipcMain.handle(WINDOW_TOGGLE_MAXIMIZE, (event): WindowState => {
    const win = getSenderWindow(event);

    if (!win) {
        return getWindowState(win);
    }

    // maximize()/unmaximize() complete asynchronously on Linux window
    // managers, so re-reading isMaximized() here would race. Report the
    // requested state instead; the WINDOW:STATE_CHANGED push stays the
    // authoritative update once the window manager has acted.
    const shouldMaximize = !win.isMaximized();

    if (shouldMaximize) {
        win.maximize();
    } else {
        win.unmaximize();
    }

    return {
        isMaximized: shouldMaximize,
        isFullScreen: win.isFullScreen(),
    };
});

/**
 * Native fullscreen transition still in flight, per window.
 *
 * setFullScreen() completes asynchronously (the macOS animation, Linux
 * window managers) and isFullScreen() keeps reporting the old value
 * meanwhile, so two quick F11 presses would both read the same stale state
 * and request the same target — an enter-then-exit would land fullscreen.
 * The next toggle is therefore decided against the pending target.
 *
 * The entry can never govern F11 for good: it is dropped when a transition
 * event reports the target state, a transition that lands on the OTHER
 * state re-issues the target (the queued request may have been dropped by
 * the platform), and an entry older than the transition timeout is ignored
 * outright, since no native transition takes that long — a request that
 * produced no event at all is then simply forgotten.
 */
interface PendingFullScreenTransition {
    target: boolean;
    requestedAt: number;
}

/** Longest a native transition is trusted to still be in flight. */
export const FULLSCREEN_TRANSITION_TIMEOUT_MS = 2000;

const pendingFullScreenTransitions = new WeakMap<
    Electron.BrowserWindow,
    PendingFullScreenTransition
>();
const windowsWithTransitionListeners = new WeakSet<Electron.BrowserWindow>();

function getPendingFullScreenTarget(
    win: Electron.BrowserWindow,
    now: number
): boolean | undefined {
    const pending = pendingFullScreenTransitions.get(win);

    if (!pending) {
        return undefined;
    }

    if (now - pending.requestedAt > FULLSCREEN_TRANSITION_TIMEOUT_MS) {
        pendingFullScreenTransitions.delete(win);
        return undefined;
    }

    return pending.target;
}

function requestFullScreen(
    win: Electron.BrowserWindow,
    target: boolean,
    now: number
): void {
    if (!windowsWithTransitionListeners.has(win)) {
        windowsWithTransitionListeners.add(win);
        const settle = () => {
            const pending = pendingFullScreenTransitions.get(win);
            if (!pending || win.isDestroyed()) {
                return;
            }

            pendingFullScreenTransitions.delete(win);
            if (win.isFullScreen() !== pending.target) {
                // An earlier transition landed, not the requested one. Ask
                // again rather than trusting the platform to have queued
                // it: a second identical request is a no-op at worst.
                requestFullScreen(win, pending.target, Date.now());
            }
        };
        win.on('enter-full-screen', settle);
        win.on('leave-full-screen', settle);
    }

    pendingFullScreenTransitions.set(win, { target, requestedAt: now });
    win.setFullScreen(target);
}

// F11. This is the exit path from a fullscreen launch on Windows/Linux,
// where the title bar is hidden and the custom controls hide themselves
// while fullscreen. Like the maximize toggle it reports the requested state
// and leaves WINDOW:STATE_CHANGED authoritative.
ipcMain.handle(WINDOW_TOGGLE_FULLSCREEN, (event): WindowState => {
    const win = getSenderWindow(event);

    if (!win) {
        return getWindowState(win);
    }

    const now = Date.now();
    const shouldFullScreen = !(
        getPendingFullScreenTarget(win, now) ?? win.isFullScreen()
    );
    requestFullScreen(win, shouldFullScreen, now);

    return {
        isMaximized: win.isMaximized(),
        isFullScreen: shouldFullScreen,
    };
});

// win.close() (instead of app.quit()) so the window's 'close' handler still
// persists the window bounds before shutdown.
ipcMain.handle(WINDOW_CLOSE, (event) => {
    getSenderWindow(event)?.close();
});

ipcMain.handle(WINDOW_GET_STATE, (event): WindowState => {
    return getWindowState(getSenderWindow(event));
});
