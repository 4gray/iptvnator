import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
export * from './portal-watch-state-classifier';

/** Full-progress position row that marks one movie as watched. */
export function buildWatchedVodPosition(options: {
    playlistId: string;
    contentXtreamId: number;
    /** Runtime the detail view knows (Xtream `duration_secs`); may be absent. */
    durationSeconds?: number | null;
    /** The row already stored, whose real duration beats any metadata guess. */
    currentPosition?: PlaybackPositionData | null;
}): PlaybackPositionData {
    // A watched row is "position === duration", so any positive duration
    // works; 1 s is the same fallback the episode toggle uses when the
    // provider states no runtime at all.
    const duration =
        positiveOrNull(options.currentPosition?.durationSeconds) ??
        positiveOrNull(options.durationSeconds) ??
        1;

    return {
        contentXtreamId: options.contentXtreamId,
        contentType: 'vod',
        activityAction: 'mark-watched',
        positionSeconds: duration,
        durationSeconds: duration,
        playlistId: options.playlistId,
        updatedAt: new Date().toISOString(),
    };
}

function positiveOrNull(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;
}
