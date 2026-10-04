export interface PendingLiveSeek {
    observed: number;
    observedAt: number;
    target: number;
}

/** Natural playback drift is not a seek acknowledgement. A discontinuity or expiry is. */
export function pendingLiveSeekBase(
    pending: PendingLiveSeek | undefined,
    observed: number,
    now: number,
    playing: boolean,
    speed = 1
): number {
    if (!pending) return observed;
    const elapsed = Math.max(0, now - pending.observedAt);
    const expected =
        pending.observed + (playing ? (elapsed / 1000) * speed : 0);
    return elapsed <= 2000 && Math.abs(observed - expected) <= 1
        ? pending.target
        : observed;
}
