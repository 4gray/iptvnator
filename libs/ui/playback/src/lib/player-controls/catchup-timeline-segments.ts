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

    // The activated programme owns its own span, whatever the guide holds
    // there: another date's list may lack it, and an overlapping or revised
    // entry must not relabel the archive being played. Other programmes
    // only fill the window after it.
    const activeStop = programmeSeconds(active.stop, active.stopTimestamp);
    const ownEnd = Math.min(activeStop ?? windowStart, windowEnd);
    const segments: PlayerTimelineSegment[] =
        ownEnd > windowStart
            ? [
                  {
                      startSeconds: 0,
                      endSeconds: ownEnd - windowStart,
                      title: active.title?.trim() || null,
                  },
              ]
            : [];
    for (const programme of programmes ?? []) {
        const start = programmeSeconds(
            programme.start,
            programme.startTimestamp
        );
        const stop = programmeSeconds(programme.stop, programme.stopTimestamp);
        if (start === null || stop === null) {
            continue;
        }
        const clippedStart = Math.max(start, ownEnd, windowStart);
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
