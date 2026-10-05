import {
    getSeriesNextUp,
    isPortalPlaybackWatched,
    type SeriesEpisodeEntry,
    type SeriesNextUp,
} from '@iptvnator/portal/shared/util';
import {
    resolvePortalActivityWatchKind,
    type PlaybackPositionData,
    type PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import type { DashboardSeriesEpisodes } from './dashboard-series-episodes.service';

/** Finished-episode series looked up per visit, newest first. */
export const CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT = 20;

/**
 * How long, from the first lookup, Continue Watching waits for episode lists
 * before showing what it knows: a slow portal must not hold the rail back.
 */
export const CONTINUE_WATCHING_SERIES_LOOKUP_WAIT_MS = 2000;

/**
 * Where a series stands once its newest episode is watched, or is an extra:
 * - `continue`: the episode it goes on with (`getSeriesNextUp`): the first
 *   one not watched after the episode watched last, resumed where it was
 *   left if it was started. Extras (season 0) never change it;
 * - `finished`: no unwatched episode follows the one watched last, even if
 *   an earlier one was skipped or extras are left, or the series is older
 *   than the lookup limit;
 * - `unknown`: its episode list is missing (loading, failed, empty) or does
 *   not hold the episodes played. The series then keeps its newest episode
 *   rather than vanish on a guess.
 */
export type DashboardSeriesContinuation =
    | { readonly kind: 'unknown' }
    | { readonly kind: 'finished' }
    | { readonly kind: 'continue'; readonly position: PlaybackPositionData };

export interface DashboardSeriesCandidate {
    readonly item: PortalRecentItem;
    readonly seriesXtreamId: number;
    /** The series' newest episode row: watched, or an extra. */
    readonly newest: PlaybackPositionData;
}

export function dashboardRecentItemKey(
    item: Pick<PortalRecentItem, 'playlist_id' | 'type' | 'xtream_id' | 'id'>
): string {
    return `${item.playlist_id}::${item.type}::${item.xtream_id ?? item.id}`;
}

/**
 * Xtream series in the history whose newest episode is watched, or is an
 * extra (season 0), which never takes a series' place even left unfinished:
 * whether they stay on Continue Watching, and with which episode, depends
 * on the episode list. Series from other providers cannot be looked up and
 * keep their place.
 */
export function selectSeriesContinuationCandidates(
    items: readonly PortalRecentItem[],
    storedPosition: (item: PortalRecentItem) => PlaybackPositionData | null
): DashboardSeriesCandidate[] {
    const candidates: DashboardSeriesCandidate[] = [];
    for (const item of items) {
        if (
            item.source !== 'xtream' ||
            resolvePortalActivityWatchKind(item) !== 'series'
        ) {
            continue;
        }
        const newest = storedPosition(item);
        const seriesXtreamId = Number(newest?.seriesXtreamId);
        if (
            newest?.contentType === 'episode' &&
            (isPortalPlaybackWatched(newest) || newest.seasonNumber === 0) &&
            Number.isInteger(seriesXtreamId) &&
            seriesXtreamId > 0
        ) {
            candidates.push({ item, seriesXtreamId, newest });
        }
    }
    return candidates;
}

export function resolveDashboardSeriesContinuation(
    candidate: DashboardSeriesCandidate,
    seriesPositions: readonly PlaybackPositionData[],
    episodes: DashboardSeriesEpisodes | null | undefined
): DashboardSeriesContinuation {
    if (episodes?.status !== 'loaded') {
        return { kind: 'unknown' };
    }
    let nextUp: SeriesNextUp | null;
    try {
        nextUp = getSeriesNextUp({
            seasons: episodes.seasons,
            playbackPositions: new Map(
                seriesPositions.map((row) => [row.contentXtreamId, row])
            ),
        });
    } catch {
        // A malformed episode list says nothing about what comes next.
        return { kind: 'unknown' };
    }
    // `start`: none of the episodes played is in the list.
    if (!nextUp || nextUp.kind === 'start') {
        return { kind: 'unknown' };
    }
    if (nextUp.kind === 'caught-up') {
        return { kind: 'finished' };
    }
    const { entry } = nextUp;
    if (entry.position && !isPortalPlaybackWatched(entry.position)) {
        return { kind: 'continue', position: entry.position };
    }
    const episodeId = Number(entry.episode?.id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
        return { kind: 'unknown' };
    }
    return {
        kind: 'continue',
        position: nextEpisodeRow(candidate, episodeId, entry),
    };
}

/** The row an episode not started yet stands for: 0:00 and no progress. */
function nextEpisodeRow(
    candidate: DashboardSeriesCandidate,
    episodeId: number,
    entry: SeriesEpisodeEntry
): PlaybackPositionData {
    const seasonNumber = toEpisodeNumber(entry.seasonNumber);
    const episodeNumber = toEpisodeNumber(entry.episode.episode_num);
    return {
        contentXtreamId: episodeId,
        contentType: 'episode',
        seriesXtreamId: candidate.seriesXtreamId,
        ...(seasonNumber !== null && episodeNumber !== null
            ? { seasonNumber, episodeNumber }
            : {}),
        positionSeconds: 0,
        playlistId: candidate.newest.playlistId,
        updatedAt: candidate.newest.updatedAt,
    };
}

function toEpisodeNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}
