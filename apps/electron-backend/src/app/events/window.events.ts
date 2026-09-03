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
import { toggleFullScreen } from '../services/native-fullscreen-transitions';

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

// F11. This is the exit path from a fullscreen launch on Windows/Linux,
// where the title bar is hidden and the custom controls hide themselves
// while fullscreen. The transition tracker decides against the pending
// target while a transition (including the startup fullscreen) is still in
// flight, so two quick presses stay an enter-then-exit. Like the maximize
// toggle it reports the requested state and leaves WINDOW:STATE_CHANGED
// authoritative.
ipcMain.handle(WINDOW_TOGGLE_FULLSCREEN, (event): WindowState => {
    const win = getSenderWindow(event);

    if (!win) {
        return getWindowState(win);
    }

    return {
        isMaximized: win.isMaximized(),
        isFullScreen: toggleFullScreen(win),
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
