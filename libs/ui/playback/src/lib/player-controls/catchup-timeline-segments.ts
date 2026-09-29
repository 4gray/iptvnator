import type { EpgProgram } from '@iptvnator/shared/interfaces';
import type { PlayerTimelineSegment } from './player-controls.model';

/** The EPG fields a catch-up timeline reads from a programme. */
export type CatchupTimelineProgramme = Pick<
    EpgProgram,
    'title' | 'start' | 'stop' | 'startTimestamp' | 'stopTimestamp'
>;

/**
 * Seek-bar segments for catch-up / timeshift playback of a live channel:
 * every EPG programme overlapping the archive window, with start and end
 * relative to the playback start (the window start) and the programme title.
 *
 * The window starts at the activated programme's start. It ends at that
 * programme's stop — Xtream's timeshift URL requests exactly that range —
 * unless the host passes `windowEndSeconds`, as M3U catch-up does with the
 * moment it resolved `lutc`, since that stream runs from the programme's
 * start up to then. Times use the same rule as the EPG views: the unix
 * timestamp when present, else the parsed ISO string; programme and window
 * share that clock, so the EPG display offset cancels out.
 *
 * Returns `null` without a usable window (live playback), so the controls
 * draw one plain segment. The controls clamp the result to the stream's
 * real duration and fill any gap (`normalizeTimelineSegments`).
 */
export function buildCatchupTimelineSegments(
    programmes: readonly CatchupTimelineProgramme[] | null | undefined,
    active: CatchupTimelineProgramme | null | undefined,
    windowEndSeconds?: number
): PlayerTimelineSegment[] | null {
    if (!active) {
        return null;
    }
    const windowStart = programmeSeconds(active.start, active.startTimestamp);
    const windowEnd =
        windowEndSeconds ?? programmeSeconds(active.stop, active.stopTimestamp);
    if (
        windowStart === null ||
        windowEnd === null ||
        !Number.isFinite(windowEnd) ||
        windowEnd <= windowStart
    ) {
        return null;
    }

    const candidates = [...(programmes ?? [])];
    // The activated programme may come from a list the host no longer
    // holds (another EPG date); without a listed programme at the window
    // start it stands in for itself.
    if (!candidates.some((programme) => coversStart(programme, windowStart))) {
        candidates.push(active);
    }

    const segments: PlayerTimelineSegment[] = [];
    for (const programme of candidates) {
        const start = programmeSeconds(
            programme.start,
            programme.startTimestamp
        );
        const stop = programmeSeconds(programme.stop, programme.stopTimestamp);
        if (start === null || stop === null) {
            continue;
        }
        const clippedStart = Math.max(start, windowStart);
        const clippedEnd = Math.min(stop, windowEnd);
        if (clippedEnd <= clippedStart) {
            continue;
        }
        segments.push({
            startSeconds: clippedStart - windowStart,
            endSeconds: clippedEnd - windowStart,
            title: programme.title?.trim() || null,
        });
    }
    return segments.sort((a, b) => a.startSeconds - b.startSeconds);
}

function coversStart(
    programme: CatchupTimelineProgramme,
    seconds: number
): boolean {
    const start = programmeSeconds(programme.start, programme.startTimestamp);
    const stop = programmeSeconds(programme.stop, programme.stopTimestamp);
    return (
        start !== null && stop !== null && start <= seconds && seconds < stop
    );
}

/** Epoch seconds: the positive unix timestamp, else the parsed ISO date. */
function programmeSeconds(
    isoValue: string | null | undefined,
    timestamp: number | null | undefined
): number | null {
    const unix = Number(timestamp);
    if (timestamp != null && Number.isFinite(unix) && unix > 0) {
        return unix;
    }
    const ms = Date.parse(isoValue ?? '');
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
