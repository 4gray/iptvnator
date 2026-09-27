import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/**
 * How long a dashboard rail may keep loading before its skeleton appears.
 *
 * On a warm profile the local rails resolve within a few tens of
 * milliseconds of the first render, and several of them resolve empty. An
 * immediate skeleton for each loading rail therefore flashed and then
 * collapsed, pulling every rail below it upwards: a layout shift of about
 * 0.23 on every launch with sources (the "good" CLS threshold is 0.1).
 * Holding the skeletons back for a short grace period means a fast rail
 * appears once, in place, and a genuinely slow one (TMDB, a large portal)
 * still gets its placeholder. The hero skeleton is not delayed: it reserves
 * the top of the page, where a late insertion would push everything down.
 */
export const DASHBOARD_RAIL_SKELETON_GRACE_MS = 300;

/**
 * A signal that turns true once the grace period has elapsed. Must be
 * created in an injection context; the timer is cleared on destroy.
 */
export function createRailSkeletonGrace(
    delayMs = DASHBOARD_RAIL_SKELETON_GRACE_MS
): Signal<boolean> {
    const elapsed = signal(delayMs <= 0);
    if (delayMs > 0) {
        const timer = setTimeout(() => elapsed.set(true), delayMs);
        inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    }
    return elapsed.asReadonly();
}
