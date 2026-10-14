import {
    ElectronBridgeBackGestureSource,
    WINDOW_BACK_REQUESTED,
} from '@iptvnator/shared/interfaces';

/** `app-command` for mouse Back buttons and the Browser Back key. */
const APP_COMMAND_BACK = 'browser-backward';

/**
 * The `swipe` direction that means Back: NSEvent `deltaX > 0`, which WebKit
 * and VS Code map to Back as well.
 */
const SWIPE_BACK = 'left';

/**
 * Forwards the window's platform Back gestures to the renderer, which runs
 * the workspace header's Back (`WorkspaceBackGesturesService`) or ignores
 * the request. Both listeners are attached on every platform: Electron
 * emits `app-command` only on Windows and Linux and `swipe` only on macOS.
 * Forward (`browser-forward`, `swipe` right) is deliberately not forwarded:
 * Stalker inline details are not history entries, so Forward would skip
 * them.
 */
export function attachWindowBackGestures(win: Electron.BrowserWindow): void {
    const requestBack = (source: ElectronBridgeBackGestureSource): void => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        win.webContents.send(WINDOW_BACK_REQUESTED, source);
    };

    win.on('app-command', (_event, command) => {
        if (command === APP_COMMAND_BACK) requestBack('app-command');
    });
    win.on('swipe', (_event, direction) => {
        if (direction === SWIPE_BACK) requestBack('swipe');
    });
}
