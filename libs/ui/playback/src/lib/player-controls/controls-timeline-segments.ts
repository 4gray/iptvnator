import type { PlayerTimelineSegment } from './player-controls.model';

/** A normalized segment as the track renders it. */
export interface TimelineSegmentView {
    startSeconds: number;
    endSeconds: number;
    title: string | null;
    /** Share of the whole duration, 0..1. */
    share: number;
    /** Left edge on the track, 0..100 — the same mapping the seek input uses. */
    startPercent: number;
    /** CSS width: the share, minus the gap every segment but the last keeps. */
    width: string;
}

/** Visual gap (px) after every segment except the last. */
export const TIMELINE_SEGMENT_GAP_PX = 3;

const WHOLE_TIMELINE: TimelineSegmentView = {
    startSeconds: 0,
    endSeconds: 0,
    title: null,
    share: 1,
    startPercent: 0,
    width: '100%',
};

/**
 * Turns host-supplied segments (chapters, programmes) into a gapless,
 * non-overlapping cover of `[0, duration]`, in playback order. Segments are
 * clamped to the duration, empty and reversed ones dropped, overlaps cut at
 * the previous segment's end, and every uncovered stretch — before the
 * first, between two, after the last — becomes an untitled segment so the
 * track always adds up to the full duration. Without a usable duration or
 * without segments the whole timeline is one untitled segment, which is
 * exactly the pre-segment rendering.
 */
export function normalizeTimelineSegments(
    segments: readonly PlayerTimelineSegment[] | null | undefined,
    durationSeconds: number
): TimelineSegmentView[] {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return [WHOLE_TIMELINE];
    }
    const clamp = (value: number) =>
        Number.isFinite(value)
            ? Math.min(durationSeconds, Math.max(0, value))
            : 0;
    const ordered = (segments ?? [])
        .map((segment) => ({
            startSeconds: clamp(segment.startSeconds),
            endSeconds: clamp(segment.endSeconds),
            title: segment.title?.trim() || null,
        }))
        .filter((segment) => segment.endSeconds > segment.startSeconds)
        .sort((a, b) => a.startSeconds - b.startSeconds);

    const cover: Pick<
        TimelineSegmentView,
        'startSeconds' | 'endSeconds' | 'title'
    >[] = [];
    let cursor = 0;
    for (const segment of ordered) {
        const startSeconds = Math.max(segment.startSeconds, cursor);
        if (startSeconds >= segment.endSeconds) {
            continue;
        }
        if (startSeconds > cursor) {
            cover.push({
                startSeconds: cursor,
                endSeconds: startSeconds,
                title: null,
            });
        }
        cover.push({ ...segment, startSeconds });
        cursor = segment.endSeconds;
    }
    if (cursor < durationSeconds) {
        cover.push({
            startSeconds: cursor,
            endSeconds: durationSeconds,
            title: null,
        });
    }
    return cover.map((segment, index) => {
        const share =
            (segment.endSeconds - segment.startSeconds) / durationSeconds;
        const last = index === cover.length - 1;
        return {
            ...segment,
            share,
            startPercent: (segment.startSeconds / durationSeconds) * 100,
            width: last
                ? `${share * 100}%`
                : `max(0px, calc(${share * 100}% - ${TIMELINE_SEGMENT_GAP_PX}px))`,
        };
    });
}

/** How much of one segment the position has played through, 0..100. */
export function segmentFillPercent(
    segment: Pick<TimelineSegmentView, 'startSeconds' | 'endSeconds'>,
    positionSeconds: number
): number {
    const length = segment.endSeconds - segment.startSeconds;
    if (length <= 0 || !Number.isFinite(positionSeconds)) {
        return 0;
    }
    const fraction = (positionSeconds - segment.startSeconds) / length;
    return Math.min(100, Math.max(0, fraction * 100));
}

/** The segment containing `seconds`; the last one at the very end. */
export function findTimelineSegment(
    segments: readonly TimelineSegmentView[],
    seconds: number
): TimelineSegmentView | null {
    if (!Number.isFinite(seconds)) {
        return null;
    }
    for (const segment of segments) {
        if (seconds >= segment.startSeconds && seconds < segment.endSeconds) {
            return segment;
        }
    }
    const last = segments[segments.length - 1];
    return last && seconds >= last.endSeconds ? last : null;
}
