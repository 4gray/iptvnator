import {
    DestroyRef,
    effect,
    inject,
    signal,
    untracked,
    type Signal,
} from '@angular/core';

/**
 * How long a dashboard rail may keep loading, counted from the moment that
 * rail started loading, before its skeleton may appear.
 *
 * The rails render as soon as their own data arrives, and on a normal profile
 * several resolve empty within a few tens of milliseconds. An immediate
 * skeleton per loading rail therefore flashed and collapsed, pulling every
 * rail below it upwards: a layout shift of about 0.23 on each launch with
 * sources (the "good" CLS threshold is 0.1). The hero keeps its immediate
 * skeleton: it reserves the top of the page.
 */
export const DASHBOARD_RAIL_SKELETON_GRACE_MS = 300;

/** One rail, in template order. */
export interface DashboardRailSkeletonEntry {
    /** True while this rail's data is loading and a skeleton would help. */
    readonly loading: () => boolean;
    /** True once this rail renders real cards. */
    readonly rendered: () => boolean;
}

/**
 * Per-rail skeleton visibility. A rail's skeleton appears only when
 *
 * 1. the rail has been loading for the grace period, measured from when
 *    *this* rail started loading (rails such as Xtream or TMDB begin their
 *    requests after the local ones), and
 * 2. no rail below it already shows real cards: inserting a placeholder
 *    above visible content would push it down, and pull it back up if the
 *    rail resolves empty, whereas the real rail inserts at most once.
 *
 * Once shown, a skeleton stays until its rail stops loading, so skeletons do
 * not disappear in a cascade when the first real rail arrives.
 *
 * Must be created in an injection context; timers are cleared on destroy.
 */
export function createRailSkeletonGates<Key extends string>(
    entries: readonly (readonly [Key, DashboardRailSkeletonEntry])[],
    graceMs = DASHBOARD_RAIL_SKELETON_GRACE_MS
): Record<Key, Signal<boolean>> {
    const gates = {} as Record<Key, Signal<boolean>>;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    inject(DestroyRef).onDestroy(() => {
        timers.forEach(clearTimeout);
        timers.clear();
    });

    entries.forEach(([key, entry], index) => {
        const below = entries.slice(index + 1).map(([, other]) => other);
        const renderedBelow = () => below.some((other) => other.rendered());
        const shown = signal(false);
        let timer: ReturnType<typeof setTimeout> | null = null;
        const stopTimer = () => {
            if (timer !== null) {
                clearTimeout(timer);
                timers.delete(timer);
                timer = null;
            }
        };

        effect(() => {
            const loading = entry.loading();
            untracked(() => {
                if (!loading) {
                    stopTimer();
                    shown.set(false);
                    return;
                }
                if (shown() || timer !== null) {
                    return;
                }
                if (graceMs <= 0) {
                    shown.set(!renderedBelow());
                    return;
                }
                timer = setTimeout(() => {
                    if (timer !== null) timers.delete(timer);
                    timer = null;
                    if (entry.loading() && !renderedBelow()) {
                        shown.set(true);
                    }
                }, graceMs);
                timers.add(timer);
            });
        });

        gates[key] = shown.asReadonly();
    });

    return gates;
}
