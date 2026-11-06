import {
    COLLECTION_RELOAD_STATE_KEY,
    getCollectionViewState,
} from '@iptvnator/portal/shared/util/collection-view-state';

/** Carry only collection context across the packaged file:// recovery document. */
export function prepareRendererReload(
    browser: Window,
    restoredHref: string | null
): void {
    const packaged = browser.location.protocol === 'file:';
    let restoredState = null;

    if (packaged) {
        try {
            const saved = browser.sessionStorage.getItem(
                COLLECTION_RELOAD_STATE_KEY
            );
            browser.sessionStorage.removeItem(COLLECTION_RELOAD_STATE_KEY);
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
}
