import type { Logger } from '@iptvnator/portal/shared/util';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { SeasonContainerSeriesPlaybackToggleRequest } from '@iptvnator/ui/components';
import { StalkerSeriesPositionPartialSaveError } from './stalker-series-position-compatibility';

export interface StalkerWatchToggleFeedback {
    readonly marked: string;
    readonly unmarked: string;
    readonly partialMarked: string;
    readonly partialUnmarked: string;
    readonly failed: string;
}

// The marked and partial keys are scope-generic on purpose ("{{count}}
// episodes marked as watched", "{{count}} marked · {{failed}} failed");
// only unmark-success and failure name their scope.
export const SEASON_WATCH_FEEDBACK: StalkerWatchToggleFeedback = {
    marked: 'XTREAM.SEASON_MARKED_WATCHED',
    unmarked: 'XTREAM.SEASON_MARKED_UNWATCHED',
    partialMarked: 'XTREAM.SEASON_MARKED_WATCHED_PARTIAL',
    partialUnmarked: 'XTREAM.SEASON_MARKED_UNWATCHED_PARTIAL',
    failed: 'XTREAM.SEASON_WATCH_UPDATE_FAILED',
};

export const SERIES_WATCH_FEEDBACK: StalkerWatchToggleFeedback = {
    marked: 'XTREAM.SEASON_MARKED_WATCHED',
    unmarked: 'XTREAM.SERIES_MARKED_UNWATCHED',
    partialMarked: 'XTREAM.SEASON_MARKED_WATCHED_PARTIAL',
    partialUnmarked: 'XTREAM.SEASON_MARKED_UNWATCHED_PARTIAL',
    failed: 'XTREAM.SERIES_WATCH_UPDATE_FAILED',
};

/** One watched/unwatched batch and what it needs from the page running it. */
export interface StalkerWatchToggleBatch {
    readonly request: SeasonContainerSeriesPlaybackToggleRequest;
    readonly playlistId: string;
    /** Whether the page still shows the series the batch was started on. */
    readonly stillCurrent: () => boolean;
    readonly feedback: StalkerWatchToggleFeedback;
    readonly persist: (
        playlistId: string,
        position: PlaybackPositionData
    ) => Promise<void>;
    readonly clear: (
        playlistId: string,
        contentXtreamId: number
    ) => Promise<void>;
    /** Re-reads the catalog grid's progress badges; must not reject. */
    readonly refreshCatalogPositions: (
        playlistId: string
    ) => Promise<void> | undefined;
    /** Shows the translated feedback for `key`. */
    readonly notify: (key: string, params?: object) => void;
    readonly logger: Logger;
}

export async function runStalkerWatchToggleBatch(
    batch: StalkerWatchToggleBatch
): Promise<void> {
    const { request, playlistId, feedback } = batch;
    // Enqueue every episode synchronously: each mutation chains on
    // the previous one's never-rejecting barrier, so the queue
    // serializes the writes (incl. per-episode legacy-row cleanup)
    // and reloads positions once after the whole chain drains.
    const outcomes = await Promise.all(
        request.requests.map((item) =>
            (item.nextPosition
                ? batch.persist(playlistId, item.nextPosition)
                : batch.clear(playlistId, item.contentXtreamId)
            ).then(
                () => true,
                // The scoped watched row was saved and published —
                // only the legacy-row cleanup failed. The episode IS
                // watched, so it must not count against the batch.
                (error: unknown) =>
                    error instanceof StalkerSeriesPositionPartialSaveError
            )
        )
    );

    const failed = outcomes.filter((ok) => !ok).length;
    const succeeded = outcomes.length - failed;
    if (failed > 0) {
        batch.logger.error(
            `Watched toggle: ${failed} of ${outcomes.length} episodes failed`
        );
    }
    if (succeeded > 0) {
        // Partial successes changed rows too — the catalog badge
        // must follow even when the user already moved on. A failed
        // refresh must not break the feedback flow below.
        await batch.refreshCatalogPositions(playlistId);
    }
    if (!batch.stillCurrent()) {
        return;
    }

    if (failed === 0) {
        batch.notify(
            request.markWatched ? feedback.marked : feedback.unmarked,
            { count: succeeded }
        );
    } else if (succeeded > 0) {
        batch.notify(
            request.markWatched
                ? feedback.partialMarked
                : feedback.partialUnmarked,
            { count: succeeded, failed }
        );
    } else {
        batch.notify(feedback.failed);
    }
}
