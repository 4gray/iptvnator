export interface PendingLiveSeekTarget {
    seconds: number;
    requestedAt: number;
}

export interface PendingLiveSeek {
    observed: number;
    observedAt: number;
    /** Ordered absolute requests; the last target is the user's latest intent. */
    targets: readonly PendingLiveSeekTarget[];
}

/** Reconcile older replies without treating them as acknowledgement of the latest seek. */
export function reconcilePendingLiveSeek(
    pending: PendingLiveSeek | undefined,
    observed: number,
    now: number,
    playing: boolean,
    speed = 1
): { base: number; outstandingTargets: readonly PendingLiveSeekTarget[] } {
    const settled = { base: observed, outstandingTargets: [] };
    const target = pending?.targets.at(-1);
    if (!pending || target === undefined) return settled;
    const elapsed = Math.max(0, now - pending.observedAt);
    if (elapsed > 2000) return settled;
    const multiplier = playing ? Math.max(0, speed) : 0;
    const drift = (elapsed / 1000) * multiplier;
    // Seek completion can occur anywhere in this interval. Snapshots have
    // whole-second precision, so account for rounding as well as playback drift.
    const acknowledges = (requested: PendingLiveSeekTarget) =>
        observed >= requested.seconds - 1 &&
        observed <=
            requested.seconds +
                (Math.max(0, now - requested.requestedAt) / 1000) * multiplier +
                1;
    if (acknowledges(target)) return settled;
    if (Math.abs(observed - (pending.observed + drift)) <= 1) {
        return { base: target.seconds, outstandingTargets: pending.targets };
    }
    for (let index = pending.targets.length - 2; index >= 0; index--) {
        if (acknowledges(pending.targets[index])) {
            return {
                base: target.seconds,
                outstandingTargets: pending.targets.slice(index + 1),
            };
        }
    }
    return settled;
}
