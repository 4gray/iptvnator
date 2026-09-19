import { DestroyRef, Signal, signal } from '@angular/core';

/**
 * Grace period before a reload with content already on screen shows its
 * indicator. IndexedDB/SQLite collection reads usually settle inside this
 * window; painting a progress bar for them would only flash.
 */
export const COLLECTION_RELOAD_INDICATOR_DELAY_MS = 180;

export interface CollectionReloadIndicator {
    /** A reload is in flight while the previous items stay on screen. */
    readonly active: Signal<boolean>;
    /** The reload has outlived the grace period: render the indicator. */
    readonly visible: Signal<boolean>;
    /** Mark a reload as started. Repeated calls keep the earliest deadline. */
    begin(): void;
    /** The latest reload settled (success or failure); hide everything. */
    settle(): void;
}

/**
 * Non-destructive loading state for reloads of a list that is already
 * rendered. Unlike the first-load skeleton it never unmounts content, so a
 * playing channel, the toggle the user just clicked and its focus survive.
 */
export function createCollectionReloadIndicator(
    destroyRef: DestroyRef,
    delayMs = COLLECTION_RELOAD_INDICATOR_DELAY_MS
): CollectionReloadIndicator {
    const active = signal(false);
    const visible = signal(false);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    destroyRef.onDestroy(clearTimer);

    return {
        active: active.asReadonly(),
        visible: visible.asReadonly(),
        begin(): void {
            active.set(true);
            if (visible() || timer !== null) {
                return;
            }
            timer = setTimeout(() => {
                timer = null;
                if (active()) {
                    visible.set(true);
                }
            }, delayMs);
        },
        settle(): void {
            clearTimer();
            active.set(false);
            visible.set(false);
        },
    };
}
