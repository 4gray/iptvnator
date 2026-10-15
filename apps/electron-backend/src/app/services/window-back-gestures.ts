import {
    ElectronBridgeBackGestureSource,
    WINDOW_BACK_REQUESTED,
} from '@iptvnator/shared/interfaces';

/** `app-command` for mouse Back buttons and the Browser Back key. */
const APP_COMMAND_BACK = 'browser-backward';

/** DOM `key` of the keyboard Browser Back key. */
const BROWSER_BACK_KEY = 'BrowserBack';

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
export function attachWindowBackGestures(
    win: Electron.BrowserWindow,
    platform: NodeJS.Platform = process.platform
): void {
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

    if (platform === 'linux') {
        // On Linux Electron raises `app-command` for every unhandled event
        // of the Browser Back key, keydown and keyup alike
        // (`NativeWindowViews::HandleKeyboardEvent`), so one press would go
        // back twice. The key is taken here instead: Back once per press,
        // and a consumed key never reaches that handler. Mouse Back buttons
        // still arrive as `app-command`.
        win.webContents.on('before-input-event', (event, input) => {
            if (input.key !== BROWSER_BACK_KEY) return;
            event.preventDefault();
            if (input.type === 'keyDown' && !input.isAutoRepeat) {
                requestBack('app-command');
            }
        });
    }
}
