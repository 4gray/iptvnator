import {
    DestroyRef,
    effect,
    inject,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
    nextSourceExpiryChangeMs,
    SOURCE_EXPIRY_MAX_WAIT_MS,
    type SourceExpiryFacts,
} from '@iptvnator/workspace/dashboard/data-access';

/** A boundary timer can fire a hair early; land safely past it. */
const BOUNDARY_SLACK_MS = 1_000;

/**
 * Wall-clock ms that moves only when a source-expiry badge can change.
 *
 * Badges move at day granularity, so instead of polling the clock this arms
 * one timer for the earliest badge boundary among the known facts (none at
 * all when no badge can change; an hourly recheck for a timestamp that has
 * already passed, in case the system clock is corrected backward), capped at {@link SOURCE_EXPIRY_MAX_WAIT_MS}
 * because timers do not follow system sleep or clock changes. No timer is
 * armed while the document is hidden or `active` is false; becoming visible
 * re-reads the clock at once. Must be created in
 * an injection context.
 */
export function createSourceExpiryClock(
    facts: Signal<ReadonlyMap<string, SourceExpiryFacts>>,
    /** False while no badge can render (the sources rail is disabled). */
    active: Signal<boolean> = signal(true)
): Signal<number> {
    const document = inject(DOCUMENT);
    const now = signal(Date.now());
    const visible = signal(!document.hidden);

    effect((onCleanup) => {
        // Read for the dependency; schedule from the real time, because the
        // facts can change long after the clock last moved.
        now();
        // Hidden, or the sources rail is off: no badge is on screen. Becoming
        // visible moves the clock and re-runs this effect; so does `active`.
        if (!visible() || !active()) return;
        const nowMs = Date.now();
        let next: number | null = null;
        // A badge derived from a timestamp can still change if the system
        // clock is corrected backward, so it keeps the hourly recheck even
        // with no boundary ahead. A portal-reported expiry is terminal.
        let clockDependent = false;
        for (const entry of facts().values()) {
            if (!entry.reportedExpired && (entry.expiresAtSeconds ?? 0) > 0) {
                clockDependent = true;
            }
            const change = nextSourceExpiryChangeMs(entry, nowMs);
            if (change !== null && (next === null || change < next)) {
                next = change;
            }
        }
        // No badge can change any more: new facts re-run this effect.
        if (next === null && !clockDependent) return;
        const delay =
            next === null
                ? SOURCE_EXPIRY_MAX_WAIT_MS
                : Math.min(
                      Math.max(next - nowMs, 0) + BOUNDARY_SLACK_MS,
                      SOURCE_EXPIRY_MAX_WAIT_MS
                  );
        const timer = setTimeout(() => now.set(Date.now()), delay);
        onCleanup(() => clearTimeout(timer));
    });

    // Re-enabling the rail must not show a badge cached while it was off: a
    // boundary may have passed (an expired source has no next boundary to
    // wait for), so read the clock at once, as becoming visible does.
    let wasActive = untracked(active);
    effect(() => {
        const isActive = active();
        if (isActive && !wasActive) untracked(() => now.set(Date.now()));
        wasActive = isActive;
    });

    const onVisibilityChange = () => {
        visible.set(!document.hidden);
        if (!document.hidden) now.set(Date.now());
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() =>
        document.removeEventListener('visibilitychange', onVisibilityChange)
    );

    return now.asReadonly();
}
