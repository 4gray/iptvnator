/**
 * Route hand-off for a reloaded packaged renderer.
 *
 * The packaged renderer is loaded from `dist/apps/web/index.html` over
 * `file://` and Angular uses PATH routing, so after in-app navigation the
 * document URL is `file:///…/web/workspace/sources` — a path with no file
 * behind it. A reload (the macOS View › Reload menu, DevTools, the settings
 * unsaved-changes guard's confirmed reload) therefore fails with
 * `ERR_FILE_NOT_FOUND` and strands the window on Chromium's error page.
 *
 * The Electron main process recovers such a failure by loading `index.html`
 * again with the failed URL's route (its path relative to the renderer root,
 * plus query and fragment) carried in this query parameter. The renderer
 * consumes it before Angular bootstraps: `resolveRestoredRendererRoute`
 * turns the current document URL into the in-app URL the router should
 * start from, and `main.ts` installs it with `history.replaceState`, so the
 * router's initial navigation lands on the route the user was on.
 */

/** Query parameter carrying the route to restore on the reloaded index. */
export const RENDERER_RESTORE_ROUTE_QUERY_PARAM = 'restoreRoute';

/**
 * The URL to present instead of `currentHref` before the router's initial
 * navigation, or `null` when the document carries no restore request.
 *
 * `baseUri` is `document.baseURI`: the packaged build's `<base href="./">`
 * resolves to the renderer's directory, which is also what Angular strips
 * from `location.pathname` to obtain the route. A route that would leave
 * that directory — an absolute URL, another scheme, a `..` escape — is
 * dropped and only the parameter is removed, so the app boots at its
 * default route rather than following an arbitrary target.
 */
export function resolveRestoredRendererRoute(
    currentHref: string,
    baseUri: string
): string | null {
    let current: URL;
    let baseDirectory: URL;

    try {
        current = new URL(currentHref);
        baseDirectory = new URL('./', baseUri);
    } catch {
        return null;
    }

    const route = current.searchParams.get(RENDERER_RESTORE_ROUTE_QUERY_PARAM);

    if (route === null) {
        return null;
    }

    current.searchParams.delete(RENDERER_RESTORE_ROUTE_QUERY_PARAM);
    const stripped = current.href;

    let target: URL;

    try {
        target = new URL(route, baseDirectory);
    } catch {
        return stripped;
    }

    const staysInsideRenderer =
        target.protocol === baseDirectory.protocol &&
        target.host === baseDirectory.host &&
        target.pathname.startsWith(baseDirectory.pathname) &&
        target.pathname !== baseDirectory.pathname;

    return staysInsideRenderer ? target.href : stripped;
}
