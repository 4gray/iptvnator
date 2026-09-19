/**
 * Preload half of the app zoom level persistence (issue #1109).
 *
 * The level is requested synchronously at preload start and applied through
 * `webFrame.setZoomLevel`, which installs a temporary, frame-bound zoom level
 * instead of Chromium's per-URL entry — the only form that survives the
 * app's `pushState` routing under `file://` (see
 * `services/window-zoom-level.ts` for the mechanism). When nothing is stored
 * it re-applies the current level for the same reason: entering temporary
 * mode makes the very first zoom shortcut URL-independent too, and keeps
 * whatever per-URL level Chromium restored on its own for this document.
 *
 * The apply itself is deferred to `DOMContentLoaded`. Calling
 * `webFrame.setZoomLevel` earlier — at preload start, or from a `setTimeout`
 * — leaves a hidden window without a first frame on Linux and Windows:
 * `ready-to-show` never fires, `show()` never runs, and the renderer gets no
 * animation frames (the splash that `main.ts` removes in a
 * `requestAnimationFrame` stays forever). macOS is unaffected, which is why
 * only the packaged Linux/Windows E2E caught it. After the parser finishes
 * the call is harmless, and it still lands before the first Angular paint.
 */

import {
    stepZoomLevel,
    type ZoomLevelAction,
} from '@iptvnator/shared/interfaces/zoom-level';

export interface PreloadZoomLevelPorts {
    /** `ipcRenderer.sendSync(WINDOW_GET_ZOOM_LEVEL)` — the stored level or null. */
    requestPersistedZoomLevel(): unknown;
    /** `webFrame.getZoomLevel()` */
    getZoomLevel(): number;
    /** `webFrame.setZoomLevel(level)` */
    setZoomLevel(level: number): void;
    /** Runs `apply` once the document is parsed (DOMContentLoaded), or at once if it already is. */
    whenDocumentParsed(apply: () => void): void;
    /** `ipcRenderer.send(WINDOW_ZOOM_LEVEL_APPLIED)` — hands the main process ownership of the level. */
    notifyApplied(): void;
}

/**
 * Returns the level that will be applied, or `null` when the request failed.
 * A failure here must never break the bridge: the preload continues and the
 * window merely keeps Chromium's default zoom behaviour for this load.
 */
export function applyPersistedZoomLevel(
    ports: PreloadZoomLevelPorts
): number | null {
    try {
        const saved = ports.requestPersistedZoomLevel();
        const level =
            typeof saved === 'number' && Number.isFinite(saved)
                ? saved
                : ports.getZoomLevel();

        ports.whenDocumentParsed(() => {
            try {
                ports.setZoomLevel(level);
                ports.notifyApplied();
            } catch {
                // Same contract as below: never take the bridge down.
            }
        });
        return level;
    } catch {
        return null;
    }
}

/**
 * Bridge half of the zoom shortcuts (`window.electron.adjustZoomLevel`):
 * steps the frame's temporary level in place. Same `webFrame` route as the
 * restore above, so the result is URL-independent and `getZoomLevel()` in the
 * main process reports it for the close/quit/reload persistence. Returns the
 * level now applied; a refused write leaves the frame as it was and returns
 * its current level, so the caller never learns a level that is not on
 * screen.
 */
export function adjustFrameZoomLevel(
    ports: Pick<PreloadZoomLevelPorts, 'getZoomLevel' | 'setZoomLevel'>,
    action: ZoomLevelAction
): number {
    const current = ports.getZoomLevel();
    const next = stepZoomLevel(current, action);

    if (next !== current) {
        try {
            ports.setZoomLevel(next);
        } catch {
            return current;
        }
    }

    return next;
}
