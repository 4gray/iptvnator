/**
 * App-wide zoom level persistence (issue #1109).
 *
 * The packaged renderer runs under `file://` with path routing, and Chromium
 * keys per-host zoom by the FULL URL when a URL has no host — so every
 * `pushState` to another section owns a separate zoom entry, and the next
 * visual-properties sync (a window resize, a display change) snaps the
 * renderer back to that entry's default. `webContents.setZoomLevel` from the
 * main process writes exactly those per-URL entries and cannot fix this.
 *
 * The preload therefore applies the persisted level with
 * `webFrame.setZoomLevel`, which installs a TEMPORARY zoom level bound to the
 * frame instead of the URL: it survives in-page navigation and resizes, the
 * menu-role zoom shortcuts increment it, and `getZoomLevel()` reports it
 * regardless of the current route. Chromium never persists temporary zoom,
 * so this module owns the electron-conf side: it hands the preload the saved
 * level and writes the live level back on close, quit, and every
 * cross-document navigation (a reload clears the temporary level, and the
 * new document's preload reads whatever was saved last).
 */

import { store, ZOOM_LEVEL } from './store.service';

/**
 * WebContents whose preload has applied the app-owned zoom level, i.e. whose
 * `getZoomLevel()` now reflects the user's choice rather than Chromium's
 * per-URL default. Saving before that point would overwrite the persisted
 * level with the pre-load value.
 */
const zoomOwningContents = new WeakSet<Electron.WebContents>();

export function readPersistedZoomLevel(): number | null {
    const level = store.get(ZOOM_LEVEL);
    return typeof level === 'number' && Number.isFinite(level) ? level : null;
}

/** Records that `contents` applied the app-owned level (preload handshake). */
export function markZoomLevelApplied(contents: Electron.WebContents): void {
    zoomOwningContents.add(contents);
}

/**
 * Write the live zoom level of `win` to electron-conf. A no-op until the
 * window's preload took ownership of the level, and never touches a
 * destroyed webContents, whose `getZoomLevel()` would throw.
 */
export function persistZoomLevel(win: Electron.BrowserWindow): void {
    const contents = win.webContents;

    if (!zoomOwningContents.has(contents) || contents.isDestroyed()) {
        return;
    }

    const level = contents.getZoomLevel();

    if (Number.isFinite(level)) {
        store.set(ZOOM_LEVEL, level);
    }
}

/**
 * Save the level right before a cross-document navigation (reload, or a
 * navigation the app itself never issues). `did-start-navigation` still
 * observes the temporary level; by `did-finish-load` Chromium has dropped it,
 * and the new document's preload has already asked for the stored value.
 * Ownership is released with it: until that preload answers, the window's
 * `getZoomLevel()` is the per-URL default again and must not be saved.
 */
export function attachZoomLevelPersistence(win: Electron.BrowserWindow): void {
    const contents = win.webContents;

    contents.on('did-start-navigation', (details) => {
        if (!details.isMainFrame || details.isSameDocument) {
            return;
        }

        persistZoomLevel(win);
        zoomOwningContents.delete(contents);
    });
}
