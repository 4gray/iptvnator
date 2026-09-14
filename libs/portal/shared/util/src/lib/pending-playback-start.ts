import { signal } from '@angular/core';

/**
 * Tracks the one playback start still between the click and the player
 * (a portal resolution, or closing the previous player), keyed by the
 * content it was started for.
 *
 * Only the latest start may clear the flag, so an older resolution that
 * settles late cannot erase a newer one — and `isPendingFor` answers for
 * ONE owner, so a stale start for the previous movie never holds the next
 * movie's watched toggle hostage.
 */
export interface PendingPlaybackStart<TOwner> {
    /** Records a new start and returns its id for `settle`. */
    begin(owner: TOwner): number;
    /** Clears the flag if this start is still the latest one. */
    settle(startId: number): void;
    /** Reactive: whether the latest start belongs to this owner. */
    isPendingFor(owner: TOwner): boolean;
}

export function createPendingPlaybackStart<
    TOwner,
>(): PendingPlaybackStart<TOwner> {
    const pending = signal<{ startId: number; owner: TOwner } | null>(null);
    let sequence = 0;

    return {
        begin(owner) {
            const startId = ++sequence;
            pending.set({ startId, owner });
            return startId;
        },
        settle(startId) {
            if (pending()?.startId === startId) {
                pending.set(null);
            }
        },
        isPendingFor(owner) {
            const current = pending();
            return current !== null && current.owner === owner;
        },
    };
}
