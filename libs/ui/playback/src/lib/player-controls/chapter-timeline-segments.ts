import type { PlayerTimelineSegment } from './player-controls.model';

/** A file chapter as an engine reports it: its start and optional title. */
export interface PlayerChapter {
    startSeconds: number;
    title?: string | null;
}

/**
 * Turns an engine's chapter list into timeline segments: each chapter runs
 * from its start to the next chapter's start, the last one to the end of the
 * media. Chapters outside `[0, duration)` and repeated start times are
 * dropped. Without a finite duration or any usable chapter there is nothing
 * to draw, so the result is null and the track stays one plain bar.
 */
export function buildChapterTimelineSegments(
    chapters: readonly PlayerChapter[] | null | undefined,
    durationSeconds: number | null | undefined
): PlayerTimelineSegment[] | null {
    if (
        !chapters?.length ||
        typeof durationSeconds !== 'number' ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0
    ) {
        return null;
    }
    const starts = chapters
        .filter(
            (chapter) =>
                Number.isFinite(chapter.startSeconds) &&
                chapter.startSeconds >= 0 &&
                chapter.startSeconds < durationSeconds
        )
        .sort((a, b) => a.startSeconds - b.startSeconds)
        .filter(
            (chapter, index, sorted) =>
                index === 0 ||
                chapter.startSeconds !== sorted[index - 1].startSeconds
        );
    if (starts.length === 0) {
        return null;
    }
    return starts.map((chapter, index) => ({
        startSeconds: chapter.startSeconds,
        endSeconds: starts[index + 1]?.startSeconds ?? durationSeconds,
        title: chapter.title?.trim() || null,
    }));
}

/** Value equality, so a re-polled but unchanged chapter list is no update. */
export function sameTimelineSegments(
    a: readonly PlayerTimelineSegment[] | null,
    b: readonly PlayerTimelineSegment[] | null
): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    return a.every(
        (segment, index) =>
            segment.startSeconds === b[index].startSeconds &&
            segment.endSeconds === b[index].endSeconds &&
            segment.title === b[index].title
    );
}
