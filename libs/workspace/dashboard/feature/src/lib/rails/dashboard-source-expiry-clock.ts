import { DestroyRef, effect, inject, signal, type Signal } from '@angular/core';
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
 * all when no badge can change), capped at {@link SOURCE_EXPIRY_MAX_WAIT_MS}
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
        for (const entry of facts().values()) {
            const change = nextSourceExpiryChangeMs(entry, nowMs);
            if (change !== null && (next === null || change < next)) {
                next = change;
            }
        }
        // No badge can change any more: new facts re-run this effect.
        if (next === null) return;
        const delay = Math.min(
            Math.max(next - nowMs, 0) + BOUNDARY_SLACK_MS,
            SOURCE_EXPIRY_MAX_WAIT_MS
        );
        const timer = setTimeout(() => now.set(Date.now()), delay);
        onCleanup(() => clearTimeout(timer));
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
