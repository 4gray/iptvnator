import {
    getSeriesQuickStartAction,
    isPortalPlaybackWatched,
    SERIES_QUICK_START_ACTION_KIND,
    type SeriesQuickStartAction,
} from '@iptvnator/portal/shared/util';
import {
    resolvePortalActivityWatchKind,
    type PlaybackPositionData,
    type PortalRecentItem,
    type XtreamSerieEpisode,
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
 * Where a series stands once its newest episode is watched:
 * - `continue`: the episode it goes on with, chosen like the series page's
 *   quick start (an episode left unfinished, else the next unwatched one);
 * - `finished`: every episode is watched, or the series is older than the
 *   lookup limit;
 * - `unknown`: its episode list is missing (loading, failed or empty). The
 *   series then keeps its newest episode rather than vanish on a guess.
 */
export type DashboardSeriesContinuation =
    | { readonly kind: 'unknown' }
    | { readonly kind: 'finished' }
    | { readonly kind: 'continue'; readonly position: PlaybackPositionData };

export interface DashboardSeriesCandidate {
    readonly item: PortalRecentItem;
    readonly seriesXtreamId: number;
    /** The series' newest episode row; it is watched. */
    readonly newest: PlaybackPositionData;
}

export function dashboardRecentItemKey(
    item: Pick<PortalRecentItem, 'playlist_id' | 'type' | 'xtream_id' | 'id'>
): string {
    return `${item.playlist_id}::${item.type}::${item.xtream_id ?? item.id}`;
}

/**
 * Xtream series in the history whose newest episode is watched: whether they
 * stay on Continue Watching depends on what comes next. Series from other
 * providers cannot be looked up and keep their place.
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
            isPortalPlaybackWatched(newest) &&
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
    let action: SeriesQuickStartAction | null;
    try {
        action = getSeriesQuickStartAction({
            seasons: episodes.seasons as Record<string, XtreamSerieEpisode[]>,
            playbackPositions: new Map(
                seriesPositions.map((row) => [row.contentXtreamId, row])
            ),
        });
    } catch {
        // A malformed episode list says nothing about what comes next.
        return { kind: 'unknown' };
    }
    if (!action) {
        return { kind: 'unknown' };
    }
    if (action.kind === SERIES_QUICK_START_ACTION_KIND.Completed) {
        return { kind: 'finished' };
    }
    if (action.position && !isPortalPlaybackWatched(action.position)) {
        return { kind: 'continue', position: action.position };
    }
    const episodeId = Number(action.episode?.id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
        return { kind: 'unknown' };
    }
    return {
        kind: 'continue',
        position: nextEpisodeRow(
            candidate,
            episodeId,
            action.episode,
            episodes.seasons
        ),
    };
}

/** The row an episode not started yet stands for: 0:00 and no progress. */
function nextEpisodeRow(
    candidate: DashboardSeriesCandidate,
    episodeId: number,
    episode: XtreamSerieEpisode,
    seasons: Readonly<Record<string, XtreamSerieEpisode[]>>
): PlaybackPositionData {
    const seasonNumber =
        toEpisodeNumber(episode.season) ??
        toEpisodeNumber(
            Object.entries(seasons).find(([, list]) =>
                list.includes(episode)
            )?.[0]
        );
    const episodeNumber = toEpisodeNumber(episode.episode_num);
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
