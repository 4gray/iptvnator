/**
 * Preload half of the app zoom level persistence (issue #1109).
 *
 * Runs synchronously at preload start, before the page paints. It asks the
 * main process for the persisted level and applies it through
 * `webFrame.setZoomLevel`, which installs a temporary, frame-bound zoom level
 * instead of Chromium's per-URL entry — the only form that survives the
 * app's `pushState` routing under `file://` (see
 * `services/window-zoom-level.ts` for the mechanism). When nothing is stored
 * it re-applies the current level for the same reason: entering temporary
 * mode makes the very first zoom shortcut URL-independent too, and keeps
 * whatever per-URL level Chromium restored on its own for this document.
 */

export interface PreloadZoomLevelPorts {
    /** `ipcRenderer.sendSync(WINDOW_GET_ZOOM_LEVEL)` — the stored level or null. */
    requestPersistedZoomLevel(): unknown;
    /** `webFrame.getZoomLevel()` */
    getZoomLevel(): number;
    /** `webFrame.setZoomLevel(level)` */
    setZoomLevel(level: number): void;
}

/**
 * Returns the level applied, or `null` when the handshake failed. A failure
 * here must never break the bridge: the preload continues and the window
 * merely keeps Chromium's default zoom behaviour for this load.
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

        ports.setZoomLevel(level);
        return level;
    } catch {
        return null;
    }
}
