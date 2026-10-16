/**
 * Recovery for a reload of the packaged renderer on an in-app route.
 *
 * The packaged renderer is `dist/apps/web/index.html` over `file://` and
 * Angular routes by PATH, so after the user opens a section the document URL
 * is `file:///…/web/workspace/sources`. Nothing exists at that path, and a
 * reload of it goes wrong in one of two ways depending on who starts it:
 *
 * - A main-process reload (`webContents.reload()`: the macOS View › Reload
 *   menu role, DevTools) fires no `will-navigate`. It fails with
 *   `ERR_FILE_NOT_FOUND`, Chromium commits `chrome-error://chromewebdata/`
 *   and the window stays dead until the app restarts.
 *   `attachRendererReloadFallback` answers that exact main-frame failure by
 *   loading `index.html` again with the failed URL's route in the query.
 * - A renderer-initiated reload (`window.location.reload()`: the settings
 *   unsaved-changes guard after the user confirmed a reload intent) does
 *   fire `will-navigate`, where the routed URL is not the trusted index and
 *   the navigation guard cancels it — silently, so the confirmed reload
 *   never happens. `resolveRoutedRendererUrl` lets that guard recognize the
 *   URL and `restoreRendererRoute` sends it straight to the index with the
 *   route, without a failed load in between.
 *
 * The renderer's `main.ts` restores the route before Angular bootstraps
 * (`resolveRestoredRendererRoute`). A failed `index.html` itself is never
 * re-requested (it would loop), and dev mode serves `http://localhost`,
 * whose dev server already falls back to the index.
 */

import { RENDERER_RESTORE_ROUTE_QUERY_PARAM } from '@iptvnator/shared/interfaces';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { isWindowTraceEnabled, trace } from './debug-trace';

/** Chromium net error for a `file://` URL with no file behind it. */
export const ERR_FILE_NOT_FOUND = -6;

export interface RendererLoadFailure {
    errorCode: number;
    isMainFrame: boolean;
    validatedUrl: string;
}

/** The slice of `Electron.WebContents` the fallback listens on. */
export interface RendererReloadFallbackWebContents {
    on(
        event: 'did-fail-load',
        listener: (
            event: unknown,
            errorCode: number,
            errorDescription: string,
            validatedURL: string,
            isMainFrame: boolean
        ) => void
    ): unknown;
    on(
        event: 'did-start-navigation',
        listener: (details: {
            isMainFrame: boolean;
            isSameDocument: boolean;
        }) => void
    ): unknown;
    on(event: 'dom-ready', listener: () => void): unknown;
}

/** The slice of `Electron.BrowserWindow` the recovery needs. */
export interface RendererReloadFallbackWindow {
    isDestroyed(): boolean;
    loadFile(
        filePath: string,
        options: { query: Record<string, string> }
    ): Promise<void>;
    webContents: RendererReloadFallbackWebContents;
}

/**
 * The in-app route a routed renderer URL stands for — a `file://` path
 * under the renderer root, relative to it, plus its query and fragment —
 * or `null` for anything else, including the index itself (which exists
 * and must never be rewritten, or the recovery would loop).
 */
export function resolveRoutedRendererUrl(
    url: string,
    rendererIndexPath: string
): string | null {
    let parsedUrl: URL;

    try {
        parsedUrl = new URL(url);
    } catch {
        return null;
    }

    if (parsedUrl.protocol !== 'file:') {
        return null;
    }

    let filePath: string;

    try {
        filePath = resolve(fileURLToPath(parsedUrl));
    } catch {
        return null;
    }

    const indexPath = resolve(rendererIndexPath);
    const rendererRoot = dirname(indexPath);
    const relativePath = relative(rendererRoot, filePath);

    if (
        relativePath === '' ||
        isAbsolute(relativePath) ||
        relativePath === '..' ||
        relativePath.startsWith(`..${sep}`) ||
        filePath === indexPath
    ) {
        return null;
    }

    return `${relativePath.split(sep).join('/')}${parsedUrl.search}${parsedUrl.hash}`;
}

/**
 * The route a failed load stood for, or `null` when the failure is not a
 * main-frame `ERR_FILE_NOT_FOUND` for a routed renderer URL.
 */
export function resolveReloadedRendererRoute(
    failure: RendererLoadFailure,
    rendererIndexPath: string
): string | null {
    if (failure.errorCode !== ERR_FILE_NOT_FOUND || !failure.isMainFrame) {
        return null;
    }

    return resolveRoutedRendererUrl(failure.validatedUrl, rendererIndexPath);
}

/**
 * Loads the packaged index with `route` in the query string, for the
 * renderer to restore before Angular bootstraps. A no-op on a destroyed
 * window; a failed load is reported, never left as an unhandled rejection.
 */
export function restoreRendererRoute(
    win: Pick<RendererReloadFallbackWindow, 'isDestroyed' | 'loadFile'>,
    rendererIndexPath: string,
    route: string
): void {
    if (win.isDestroyed()) {
        return;
    }

    if (isWindowTraceEnabled()) {
        trace('window', 'restore-route', { route });
    }

    void win
        .loadFile(rendererIndexPath, {
            query: { [RENDERER_RESTORE_ROUTE_QUERY_PARAM]: route },
        })
        .catch((error) => {
            console.error(
                'Failed to restore the renderer after a reload:',
                error
            );
        });
}

/**
 * Re-loads the packaged index with the failed route whenever a main-frame
 * load of a routed `file://` URL under the renderer root fails with
 * `ERR_FILE_NOT_FOUND`.
 *
 * The recovery load is deferred to the error page's `dom-ready`, never
 * issued from inside `did-fail-load`: a `loadFile` started while Chromium
 * is still committing the error page produces a document that never
 * receives animation frames — the splash stays on screen and the window
 * never paints, with `document.visibilityState` still `visible` — whereas
 * the same load after `dom-ready` paints normally (verified on the packaged
 * build; `did-fail-load` → `dom-ready` is the order Electron emits them).
 * A cross-document navigation that starts in between, anything other than
 * the failed load itself, withdraws the pending recovery, so the error
 * page's `dom-ready` can never re-load the index over a newer navigation.
 */
export function attachRendererReloadFallback(
    win: RendererReloadFallbackWindow,
    rendererIndexPath: string
): void {
    let pendingRoute: string | null = null;

    win.webContents.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) {
            pendingRoute = null;
        }
    });
    win.webContents.on(
        'did-fail-load',
        (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
            const route = resolveReloadedRendererRoute(
                { errorCode, isMainFrame, validatedUrl: validatedURL },
                rendererIndexPath
            );

            if (route !== null) {
                pendingRoute = route;
            }
        }
    );
    win.webContents.on('dom-ready', () => {
        if (pendingRoute === null) {
            return;
        }

        const route = pendingRoute;
        pendingRoute = null;
        restoreRendererRoute(win, rendererIndexPath, route);
    });
}
