import { getCollectionViewState } from '@iptvnator/portal/shared/util';
import { resolveRestoredRendererRoute } from '@iptvnator/shared/interfaces';

const RELOAD_STATE_KEY = 'iptvnator:renderer-reload-collection';

/** Carry only collection context across the packaged file:// recovery document. */
export function prepareRendererReload(browser: Window, baseUri: string): void {
    const restoredHref = resolveRestoredRendererRoute(
        browser.location.href,
        baseUri
    );
    const packaged = browser.location.protocol === 'file:';
    let restoredState = null;

    if (packaged) {
        try {
            const saved = browser.sessionStorage.getItem(RELOAD_STATE_KEY);
            browser.sessionStorage.removeItem(RELOAD_STATE_KEY);
            const snapshot = saved ? JSON.parse(saved) : null;
            if (restoredHref && snapshot?.href === restoredHref) {
                restoredState = getCollectionViewState(snapshot);
            }
        } catch {
            // Storage can be unavailable; URL recovery must still boot the app.
        }
    }

    if (restoredHref !== null) {
        browser.history.replaceState(
            packaged
                ? restoredState
                    ? { collectionViewState: restoredState }
                    : {}
                : browser.history.state,
            '',
            restoredHref
        );
    }

    if (!packaged) return;

    browser.addEventListener('pagehide', () => {
        try {
            const collectionViewState = getCollectionViewState(
                browser.history.state
            );
            browser.sessionStorage.removeItem(RELOAD_STATE_KEY);
            if (collectionViewState) {
                browser.sessionStorage.setItem(
                    RELOAD_STATE_KEY,
                    JSON.stringify({
                        href: browser.location.href,
                        collectionViewState,
                    })
                );
            }
        } catch {
            // Reload remains usable when session storage is disabled or full.
        }
    });
}
