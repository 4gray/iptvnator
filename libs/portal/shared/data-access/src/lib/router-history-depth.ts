import type { DestroyRef } from '@angular/core';
import {
    NavigationCancel,
    NavigationEnd,
    NavigationError,
    NavigationStart,
    type Router,
} from '@angular/router';

/**
 * In-app history depth from router events, for runtimes without the
 * Navigation API (older Safari and Firefox), where the browser does not say
 * whether the previous entry belongs to this app session.
 *
 * The document's first navigation is depth 0, a push adds one, a replacement
 * or a navigation that skips the location keeps the depth, and a traversal
 * restores the depth recorded for the entry it returns to. Entries from
 * before a reload were recorded by another document, so a traversal to one
 * leaves the depth unknown (null).
 */
export function trackRouterHistoryDepth(
    router: Pick<Router, 'events' | 'currentNavigation'>,
    destroyRef: Pick<DestroyRef, 'onDestroy'>
): () => number | null {
    let depth: number | null = null;
    let pending: number | null = null;
    let started = false;
    const depthByNavigationId = new Map<number, number>();
    // A Router without events (a partial test double) leaves the depth
    // unknown, which keeps browser history Back.
    if (!router.events) return () => null;

    const subscription = router.events.subscribe((event) => {
        if (event instanceof NavigationStart) {
            if (!started) {
                pending = 0;
            } else if (event.navigationTrigger === 'popstate') {
                const restoredId = event.restoredState?.navigationId;
                pending =
                    restoredId === undefined
                        ? null
                        : (depthByNavigationId.get(restoredId) ?? null);
            } else {
                const extras = router.currentNavigation()?.extras;
                pending =
                    extras?.replaceUrl || extras?.skipLocationChange
                        ? depth
                        : (depth ?? 0) + 1;
            }
            started = true;
        } else if (event instanceof NavigationEnd) {
            depth = pending;
            if (depth !== null) depthByNavigationId.set(event.id, depth);
        } else if (
            event instanceof NavigationCancel ||
            event instanceof NavigationError
        ) {
            pending = depth;
        }
    });
    destroyRef.onDestroy(() => subscription.unsubscribe());
    return () => depth;
}
