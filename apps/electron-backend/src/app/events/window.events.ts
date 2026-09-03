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
 * Target of a native fullscreen transition still in flight, per window.
 * setFullScreen() completes asynchronously (the macOS animation, Linux
 * window managers) and isFullScreen() keeps reporting the old value
 * meanwhile, so two quick F11 presses would both read the same stale state
 * and request the same target — an enter-then-exit would land fullscreen.
 * Deciding against the pending target keeps toggle parity; Electron queues
 * the second transition behind the first. The entry is dropped once a
 * transition event reports the target state, so a request the platform
 * dropped is corrected by the next press instead of sticking forever.
 */
const pendingFullScreenTargets = new WeakMap<Electron.BrowserWindow, boolean>();

function trackFullScreenTransition(
    win: Electron.BrowserWindow,
    target: boolean
): void {
    if (!pendingFullScreenTargets.has(win)) {
        const settle = () => {
            const pending = pendingFullScreenTargets.get(win);
            if (
                pending !== undefined &&
                !win.isDestroyed() &&
                win.isFullScreen() !== pending
            ) {
                // An earlier transition landed; the queued one is next.
                return;
            }
            pendingFullScreenTargets.delete(win);
            win.off('enter-full-screen', settle);
            win.off('leave-full-screen', settle);
        };
        win.on('enter-full-screen', settle);
        win.on('leave-full-screen', settle);
    }

    pendingFullScreenTargets.set(win, target);
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

    const shouldFullScreen = !(
        pendingFullScreenTargets.get(win) ?? win.isFullScreen()
    );
    trackFullScreenTransition(win, shouldFullScreen);
    win.setFullScreen(shouldFullScreen);

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
