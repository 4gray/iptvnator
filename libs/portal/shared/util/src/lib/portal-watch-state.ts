import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { getPortalPlaybackProgressPercent } from './portal-playback-positions';

/**
 * One watch state for every catalog card, movie or series, on every portal.
 *
 * - `watched`: the position row reached the completion threshold, whether
 *   playback got there or the user marked it by hand.
 * - `in-progress`: something was started but not finished. For a series it
 *   means at least one episode has a row — the catalog list cannot know how
 *   many episodes a series has, so a series never reaches `watched` here.
 * - `unwatched`: no row at all.
 */
export type PortalWatchState = 'unwatched' | 'in-progress' | 'watched';

/** Progress at or above which a movie or episode counts as watched. */
export const PORTAL_WATCHED_PROGRESS_PERCENT = 90;

export function watchStateFromProgressPercent(
    percent: number
): PortalWatchState {
    if (percent >= PORTAL_WATCHED_PROGRESS_PERCENT) {
        return 'watched';
    }
    return percent > 0 ? 'in-progress' : 'unwatched';
}

export function resolvePortalWatchState(
    position: PlaybackPositionData | null | undefined
): PortalWatchState {
    return watchStateFromProgressPercent(
        getPortalPlaybackProgressPercent(position)
    );
}

/**
 * Series catalog cards only know whether ANY episode carries a row; the
 * total episode count is not part of the list payload on either portal, so
 * the strongest truthful answer is "started".
 */
export function resolvePortalSeriesWatchState(
    hasAnyEpisodeProgress: boolean
): PortalWatchState {
    return hasAnyEpisodeProgress ? 'in-progress' : 'unwatched';
}

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
