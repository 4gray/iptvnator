import { EpgItemDialogAction } from '../epg-item-description/epg-item-description.component';
import { TimelineWhen } from './epg-timeline.utils';

const DAY_MS = 24 * 60 * 60_000;

/**
 * Catch-up / archive gating, view-agnostic so both the timeline and a future
 * list view can share it. Works off primitives (`when`, `startMs`) rather than
 * a timeline block.
 */

/** Whether a programme's start is inside the catch-up window (0 days = unlimited). */
export function isWithinArchiveWindow(
    startMs: number,
    archiveDays: number,
    nowMs: number
): boolean {
    if (archiveDays <= 0) {
        return true; // capability flagged but no explicit window
    }
    return startMs >= nowMs - archiveDays * DAY_MS;
}

/** Whether a programme can be played from its catch-up URL. Future playback
 * is offered only when the host explicitly enables it. */
export function canCatchUpProgramme(
    when: TimelineWhen,
    startMs: number,
    archivePlaybackAvailable: boolean,
    archiveDays: number,
    nowMs: number,
    futurePlaybackAvailable = false
): boolean {
    return (
        archivePlaybackAvailable &&
        (when === 'past' ||
            when === 'now' ||
            (when === 'future' && futurePlaybackAvailable)) &&
        isWithinArchiveWindow(startMs, archiveDays, nowMs)
    );
}

/** Primary action for the programme-details dialog given its playback state. */
export function epgDialogActionFor(
    when: TimelineWhen,
    canCatchUp: boolean
): EpgItemDialogAction | null {
    if (when === 'now' && !canCatchUp) {
        return 'live';
    }
    if (canCatchUp) {
        return 'timeshift';
    }
    return null;
}
