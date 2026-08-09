/**
 * Main-process side of the unsaved-changes close protection.
 *
 * The settings page arms the guard while its form is dirty
 * (`WINDOW:SET_CLOSE_GUARD`). While armed, closing the window — title-bar
 * button, custom window controls, Cmd+W, or an app quit — is intercepted
 * here and handed back to the renderer as a `WINDOW:CLOSE_REQUESTED` push,
 * where the same save/discard/stay dialog the router guard uses decides the
 * outcome. `WINDOW:CONFIRM_CLOSE` then replays the original intent (window
 * close vs. app quit) with the guard bypassed; staying simply never confirms.
 *
 * The BrowserWindow `close` event fires before the DOM `beforeunload`
 * (Electron contract), so an armed guard is always consulted first and the
 * renderer's own `beforeunload` handler only ever sees reloads.
 */

import { app, ipcMain } from 'electron';
import {
    WINDOW_CLOSE_REQUESTED,
    WINDOW_CONFIRM_CLOSE,
    WINDOW_SET_CLOSE_GUARD,
} from '@iptvnator/shared/interfaces';

type CloseIntent = 'close' | 'quit';

/** The slice of `Electron.App` the guard needs — injectable for tests. */
export interface CloseGuardApp {
    on(event: 'before-quit', listener: () => void): unknown;
    quit(): void;
}

/** The slice of `Electron.BrowserWindow` the guard needs. */
export interface CloseGuardWindow {
    isDestroyed(): boolean;
    close(): void;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    webContents: {
        isDestroyed(): boolean;
        send(channel: string): void;
        on(event: string, listener: (...args: unknown[]) => void): unknown;
    };
}

export class WindowCloseGuard {
    private guardActive = false;
    private bypassClose = false;
    private quitInProgress = false;
    private pendingIntent: CloseIntent | null = null;
    private window: CloseGuardWindow | null = null;

    constructor(private readonly electronApp: CloseGuardApp) {}

    /**
     * Distinguishes "close this window" from "quit the app": `before-quit`
     * fires before the quit closes the windows, so a close intercepted with
     * this flag set must resume as a quit — on macOS a plain `win.close()`
     * would leave the app running when the user asked it to exit.
     */
    trackQuitLifecycle(): void {
        this.electronApp.on('before-quit', () => {
            this.quitInProgress = true;
        });
    }

    /**
     * Called for every main window (macOS can rebuild it while the process
     * lives on); per-window guard state starts over with each new window.
     */
    attachToWindow(win: CloseGuardWindow): void {
        this.window = win;
        this.guardActive = false;
        this.bypassClose = false;
        this.pendingIntent = null;

        win.on('close', (event) =>
            this.handleClose(event as { preventDefault(): void }, win)
        );
        win.on('closed', () => {
            if (this.window === win) {
                this.window = null;
                this.guardActive = false;
                this.bypassClose = false;
                this.pendingIntent = null;
            }
        });
        // A full navigation (reload included) discards the renderer state the
        // guard was protecting; a gone renderer can no longer answer the
        // close request. Either way an armed guard would make the window
        // unclosable.
        win.webContents.on('did-navigate', () => {
            this.guardActive = false;
        });
        win.webContents.on('render-process-gone', () => {
            this.guardActive = false;
        });
    }

    setGuardActive(active: boolean): void {
        this.guardActive = active;
    }

    /**
     * Renderer verdict: safe to leave (settings saved or discarded). Replays
     * the intercepted intent with the guard bypassed for exactly one close.
     */
    confirmClose(): void {
        const win = this.window;

        if (!win || win.isDestroyed()) {
            return;
        }

        const intent = this.pendingIntent ?? 'close';
        this.pendingIntent = null;
        this.bypassClose = true;

        if (intent === 'quit') {
            this.electronApp.quit();
        } else {
            win.close();
        }
    }

    private handleClose(
        event: { preventDefault(): void },
        win: CloseGuardWindow
    ): void {
        // Consumed per close attempt: if this close is allowed through, the
        // quit continues on its own; if it is intercepted, the quit is
        // aborted and only `pendingIntent` remembers it.
        const wasQuit = this.quitInProgress;
        this.quitInProgress = false;

        if (!this.guardActive || this.bypassClose) {
            return;
        }

        if (win.webContents.isDestroyed()) {
            return;
        }

        event.preventDefault();
        this.pendingIntent = wasQuit ? 'quit' : 'close';
        win.webContents.send(WINDOW_CLOSE_REQUESTED);
    }
}

/**
 * Creates the app-wide guard and registers its IPC handlers. The main-window
 * hook is passed in (instead of importing `App`) to keep this module free of
 * bootstrap-order side effects.
 */
export function bootstrapWindowCloseGuard(
    onMainWindowCreated: (
        listener: (win: Electron.BrowserWindow) => void
    ) => void
): WindowCloseGuard {
    const guard = new WindowCloseGuard(app);

    guard.trackQuitLifecycle();
    // BrowserWindow satisfies CloseGuardWindow at runtime; the cast only
    // bridges Electron's per-event `on` overloads to the structural type.
    onMainWindowCreated((win) =>
        guard.attachToWindow(win as unknown as CloseGuardWindow)
    );

    ipcMain.handle(WINDOW_SET_CLOSE_GUARD, (_event, active: boolean) => {
        guard.setGuardActive(active === true);
    });
    ipcMain.handle(WINDOW_CONFIRM_CLOSE, () => {
        guard.confirmClose();
    });

    return guard;
}
