/**
 * Whether a playback request issued under parental-lock `requested` may
 * still complete now that the lock is at `current`. The embedded player
 * defers selecting the channel until its stream resolves, so the
 * enforcement service's clearing of the selection cannot retire the
 * request; a relock in between must. An UNLOCK in between is harmless — the
 * request completes.
 */
export function isStalkerPlaybackRequestLockCurrent(
    requested: number,
    current: number,
    active: boolean
): boolean {
    return requested === current || !active;
}
