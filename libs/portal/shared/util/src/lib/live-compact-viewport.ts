import { DestroyRef, inject, signal, Signal } from '@angular/core';

/**
 * The compact desktop band for live TV: wider than the phone layout
 * (≤640px, where the categories rail is an off-canvas drawer) but too narrow
 * for the categories rail, the channel list and a usable player side by
 * side. The desktop window's minimum width (900px) falls inside it.
 *
 * Local to the live layouts on purpose; the app-wide breakpoint map (UI-36)
 * is meant to absorb it.
 */
export const LIVE_COMPACT_VIEWPORT_QUERY =
    '(min-width: 641px) and (max-width: 1100px)';

/**
 * Whether the viewport is in the compact live band, kept current while the
 * caller's injector lives. `onChange` runs on every crossing, before the
 * signal updates. Must run in an injection context. Always `false` where
 * `matchMedia` is missing (JSDOM).
 */
export function injectLiveCompactViewport(
    onChange?: (compact: boolean) => void
): Signal<boolean> {
    const media =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(LIVE_COMPACT_VIEWPORT_QUERY)
            : null;
    const compact = signal(media?.matches ?? false);
    if (media) {
        const listener = (event: MediaQueryListEvent) => {
            onChange?.(event.matches);
            compact.set(event.matches);
        };
        media.addEventListener('change', listener);
        inject(DestroyRef).onDestroy(() =>
            media.removeEventListener('change', listener)
        );
    }
    return compact.asReadonly();
}
