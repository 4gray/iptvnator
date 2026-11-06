import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import { buildChapterTimelineSegments } from '../player-controls/chapter-timeline-segments';
import type { PlayerTimelineSegment } from '../player-controls/player-controls.model';

/**
 * The segments `app-player-controls` draws for an Embedded MPV session: the
 * host's catch-up programmes when it passes any, otherwise the file's own
 * chapters from mpv's `chapter-list`, which also lets a closing-credits
 * chapter time the "Up next" card.
 */
export function embeddedMpvTimelineSegments(
    hostSegments: readonly PlayerTimelineSegment[] | null,
    session: EmbeddedMpvSession | null
): readonly PlayerTimelineSegment[] | null {
    if (hostSegments?.length) {
        return hostSegments;
    }
    const chapters = session?.chapters?.map((chapter) => ({
        startSeconds: chapter.timeSeconds,
        title: chapter.title ?? null,
    }));
    return buildChapterTimelineSegments(chapters, session?.durationSeconds);
}
