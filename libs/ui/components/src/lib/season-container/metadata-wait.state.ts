import {
    type Signal,
    computed,
    effect,
    signal,
    untracked,
} from '@angular/core';

/**
 * How long episode rows wait as skeletons for TMDB metadata before the
 * provider's own data renders anyway. TMDB requests carry no timeout, and a
 * blocked or throttled TMDB host must not hold back episodes the provider
 * has already delivered.
 */
export const EPISODE_METADATA_WAIT_MS = 4000;

/**
 * `waiting`, capped: true while the host reports pending metadata, until
 * `EPISODE_METADATA_WAIT_MS` has passed for the same `scope` (the selected
 * season). A new scope, or the wait ending and starting again, re-arms it.
 * Must be created in an injection context.
 */
export function createCappedMetadataWait(
    waiting: Signal<boolean>,
    scope: Signal<unknown>,
    timeoutMs = EPISODE_METADATA_WAIT_MS
): Signal<boolean> {
    const expired = signal(false);
    effect((onCleanup) => {
        scope();
        const isWaiting = waiting();
        untracked(() => expired.set(false));
        if (!isWaiting) {
            return;
        }
        const timer = setTimeout(() => expired.set(true), timeoutMs);
        onCleanup(() => clearTimeout(timer));
    });
    return computed(() => waiting() && !expired());
}
