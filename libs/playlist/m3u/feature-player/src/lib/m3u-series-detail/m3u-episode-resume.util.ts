import { PlaybackPositionData } from '@iptvnator/shared/interfaces';

/** How close to the end still counts as finished rather than resumable. */
const RESUME_TAIL_SECONDS = 15;

/**
 * The offset an episode opens at, from what storage remembers for it.
 *
 * A row at or past the end starts over instead: resuming three seconds
 * before the credits is not resuming, and the watched badge on the row
 * already says it was finished.
 */
export function resumeOffsetOf(
    saved: PlaybackPositionData | undefined
): number | undefined {
    const seconds = saved?.positionSeconds;
    if (
        typeof seconds !== 'number' ||
        !Number.isFinite(seconds) ||
        seconds <= 0
    ) {
        return undefined;
    }

    const duration = saved?.durationSeconds;
    if (
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration > 0 &&
        seconds >= duration - RESUME_TAIL_SECONDS
    ) {
        return undefined;
    }

    return seconds;
}
