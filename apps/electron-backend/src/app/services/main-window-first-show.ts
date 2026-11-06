/**
 * When the hidden main window is first shown.
 *
 * The window is created with `show: false` and used to be shown on
 * `ready-to-show` only. That event needs the window's first visually
 * non-empty paint, and a hidden window does not always get a frame for it:
 * on Linux under X11, when the startup scripts run before that frame, the
 * next one comes about a second later. Until then nothing is on screen and
 * the renderer gets no animation frames, so the splash that `main.ts`
 * removes in a `requestAnimationFrame` stays even after the dashboard has
 * rendered (J1 on the CI runner: about 450 ms later to the first card, in
 * roughly one launch out of three, see docs/architecture/performance-journeys.md).
 *
 * The window is therefore shown at whichever comes first: `ready-to-show`
 * or the main frame's `did-finish-load`. At `did-finish-load` the inline
 * splash is parsed and styled, and the window's `backgroundColor` matches
 * it, so showing before the first paint does not flash.
 */

/** Matches `#initial-splash` in `apps/web/src/index.html`. */
export const MAIN_WINDOW_BACKGROUND_COLOR = '#1f1f23';

type OnceEmitter = {
    once(event: string, listener: () => void): unknown;
    removeListener(event: string, listener: () => void): unknown;
};

export type FirstShowWindow = OnceEmitter & {
    isDestroyed(): boolean;
    readonly webContents: OnceEmitter;
};

/** Calls `show` once, at `ready-to-show` or `did-finish-load`, whichever comes first. */
export function showMainWindowWhenLoaded(
    window: FirstShowWindow,
    show: () => void
): void {
    let shown = false;
    const showOnce = (): void => {
        if (shown) {
            return;
        }
        shown = true;
        window.removeListener('ready-to-show', showOnce);
        window.webContents.removeListener('did-finish-load', showOnce);
        if (!window.isDestroyed()) {
            show();
        }
    };
    window.once('ready-to-show', showOnce);
    window.webContents.once('did-finish-load', showOnce);
}
