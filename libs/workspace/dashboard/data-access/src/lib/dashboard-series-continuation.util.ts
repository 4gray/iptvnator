import {
    getSeriesNextUp,
    isPortalPlaybackWatched,
    type SeriesEpisodeEntry,
    type SeriesNextUp,
} from '@iptvnator/portal/shared/util';
import { reconcileStalkerSeriesPositions } from '@iptvnator/portal/stalker/data-access';
import {
    resolvePortalActivityWatchKind,
    isCatalogUnavailable,
    type PlaybackPositionData,
    type PortalRecentItem,
    type XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    dashboardStalkerSeriesKey,
    dashboardStalkerSeriesMode,
    type DashboardSeriesEpisodesRequest,
    type DashboardStalkerSeriesMode,
} from './dashboard-series-episodes-request';
import type { DashboardSeriesEpisodes } from './dashboard-series-episodes.service';

/**
 * Titles the rail can show (its RAIL_ITEM_LIMIT): series are looked up, newest
 * first, until this many titles are known to stay listed.
 */
export const CONTINUE_WATCHING_VISIBLE_ITEMS = 20;

/** Series looked up at most, so a long history cannot flood the portal. */
export const CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT = 40;

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
 *   an earlier one was skipped or extras are left;
 * - `unknown`: its episode list is missing (loading, failed, empty) or does
 *   not hold the episode played last (`stale`: the list predates it, so it
 *   is fetched again). The series then keeps its newest episode rather than
 *   vanish on a guess.
 */
export type DashboardSeriesContinuation =
    | { readonly kind: 'unknown'; readonly stale?: boolean }
    | { readonly kind: 'finished' }
    | { readonly kind: 'continue'; readonly position: PlaybackPositionData };

export interface DashboardSeriesCandidate {
    readonly item: PortalRecentItem;
    readonly seriesXtreamId: number;
    /** The series' newest episode row: watched, or an extra. */
    readonly newest: PlaybackPositionData;
}

export function dashboardRecentItemKey(
    item: Pick<
        PortalRecentItem,
        | 'playlist_id'
        | 'type'
        | 'xtream_id'
        | 'id'
        | 'source'
        | 'watch_kind'
        | 'stalker_item'
    >
): string {
    if (
        item.source === 'stalker' &&
        resolvePortalActivityWatchKind(item) === 'series'
    ) {
        return dashboardStalkerSeriesKey(
            item.playlist_id,
            item.xtream_id ?? item.id,
            dashboardStalkerSeriesMode(item.stalker_item)
        );
    }
    return `${item.playlist_id}::${item.type}::${item.xtream_id ?? item.id}`;
}

/**
 * Series whose newest episode is watched or a special need an episode list
 * to tell whether they continue with a later episode.
 */
export function selectSeriesContinuationCandidates(
    items: readonly PortalRecentItem[],
    storedPosition: (item: PortalRecentItem) => PlaybackPositionData | null,
    hasOtherWatchedEpisodes?: (
        item: PortalRecentItem,
        newest: PlaybackPositionData
    ) => boolean
): DashboardSeriesCandidate[] {
    const candidates: DashboardSeriesCandidate[] = [];
    for (const item of items) {
        if (
            isCatalogUnavailable(item) ||
            (item.source !== 'xtream' && item.source !== 'stalker') ||
            resolvePortalActivityWatchKind(item) !== 'series'
        ) {
            continue;
        }
        const newest = storedPosition(item);
        const seriesXtreamId = Number(newest?.seriesXtreamId);
        if (
            newest?.contentType === 'episode' &&
            Number.isInteger(seriesXtreamId) &&
            seriesXtreamId > 0 &&
            (isPortalPlaybackWatched(newest) ||
                newest.seasonNumber === 0 ||
                hasOtherWatchedEpisodes?.(item, newest))
        ) {
            candidates.push({ item, seriesXtreamId, newest });
        }
    }
    return candidates;
}

export interface DashboardSeriesLookupPlan {
    /** The candidates to look up, newest first. */
    readonly window: readonly DashboardSeriesCandidate[];
    /** What each looked-up candidate continues with, by recent item key. */
    readonly continuations: ReadonlyMap<string, DashboardSeriesContinuation>;
}

/**
 * Which series to look up: candidates in history order until
 * CONTINUE_WATCHING_VISIBLE_ITEMS titles stay listed, counting movies and
 * series that need no lookup, and candidates not known to be finished. Past
 * those the rail has no slot left; a finished candidate frees its slot, so
 * the window grows as answers arrive. At most
 * CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT are looked up. A candidate never
 * looked up gets no continuation and keeps its place: limiting lookups must
 * not hide a series with episodes left.
 */
export function planDashboardSeriesLookups(input: {
    readonly items: readonly PortalRecentItem[];
    readonly candidates: readonly DashboardSeriesCandidate[];
    readonly listedWithoutLookup: (item: PortalRecentItem) => boolean;
    readonly resolve: (
        candidate: DashboardSeriesCandidate
    ) => DashboardSeriesContinuation;
}): DashboardSeriesLookupPlan {
    const candidates = new Map(
        input.candidates.map((candidate) => [
            dashboardRecentItemKey(candidate.item),
            candidate,
        ])
    );
    const window: DashboardSeriesCandidate[] = [];
    const continuations = new Map<string, DashboardSeriesContinuation>();
    let listed = 0;
    for (const item of input.items) {
        if (listed >= CONTINUE_WATCHING_VISIBLE_ITEMS) {
            break;
        }
        const key = dashboardRecentItemKey(item);
        const candidate = candidates.get(key);
        if (
            !candidate ||
            continuations.has(key) ||
            window.length >= CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT
        ) {
            const known = continuations.get(key);
            if (
                known
                    ? known.kind !== 'finished'
                    : input.listedWithoutLookup(item)
            ) {
                listed++;
            }
            continue;
        }
        window.push(candidate);
        const continuation = input.resolve(candidate);
        continuations.set(key, continuation);
        if (continuation.kind !== 'finished') {
            listed++;
        }
    }
    return { window, continuations };
}

export interface DashboardSeriesClassification {
    readonly continuation: DashboardSeriesContinuation;
    readonly fullyWatched: boolean;
}

const unknownSeries: DashboardSeriesClassification = {
    continuation: { kind: 'unknown' },
    fullyWatched: false,
};

/** The rail may be caught up even when an earlier episode was skipped. */
export function classifyDashboardSeries(input: {
    readonly request: DashboardSeriesEpisodesRequest;
    readonly newest: PlaybackPositionData;
    readonly positions: readonly PlaybackPositionData[];
    readonly episodes: DashboardSeriesEpisodes | null | undefined;
    /** An untyped row may belong to another Stalker series with the same parent id. */
    readonly allowUnmappedLatest?: boolean;
}): DashboardSeriesClassification {
    const { request, newest, episodes } = input;
    if (episodes?.status !== 'loaded') {
        return unknownSeries;
    }
    const listed = listedEpisodeIds(episodes.seasons);
    if (!listed?.size) {
        return unknownSeries;
    }
    const positions = input.positions.filter(
        (row) =>
            row.contentType === 'episode' &&
            row.seriesXtreamId === request.seriesId &&
            (row.playlistId === undefined ||
                row.playlistId === request.playlistId) &&
            (request.provider !== 'stalker' ||
                matchesStalkerSeriesPosition(
                    row,
                    request.mode,
                    request.item.stalkerId
                ))
    );
    const stalker =
        request.provider === 'stalker'
            ? reconcileStalkerSeriesPositions({
                  seriesXtreamId: request.seriesId,
                  episodesBySeason: episodes.seasons,
                  seriesPositions: positions,
              })
            : null;
    // A compatible Ministra legacy id counts as listed even when a scoped
    // row also exists and supplies the actual progress.
    const newestIsListed =
        listed.has(newest.contentXtreamId) ||
        (stalker &&
            [...stalker.legacyPositionByTrackingId.values()].some(
                (row) => row.contentXtreamId === newest.contentXtreamId
            ));
    if (
        !positions.some((row) => row.contentXtreamId === newest.contentXtreamId)
    ) {
        return unknownSeries;
    }
    if (
        !newestIsListed &&
        !(
            request.provider === 'stalker' &&
            input.allowUnmappedLatest &&
            !newest.activityIdentity
        )
    ) {
        return {
            continuation: { kind: 'unknown', stale: true },
            fullyWatched: false,
        };
    }
    let nextUp: SeriesNextUp | null;
    try {
        nextUp = getSeriesNextUp({
            seasons: episodes.seasons,
            playbackPositions:
                stalker?.positionsByTrackingId ??
                new Map(positions.map((row) => [row.contentXtreamId, row])),
        });
    } catch {
        return unknownSeries;
    }
    if (!nextUp || nextUp.kind === 'start') {
        return unknownSeries;
    }
    if (nextUp.kind === 'caught-up') {
        return {
            continuation: { kind: 'finished' },
            fullyWatched: nextUp.skipped === null,
        };
    }
    const { entry } = nextUp;
    return {
        continuation: {
            kind: 'continue',
            position:
                entry.position && !isPortalPlaybackWatched(entry.position)
                    ? entry.position
                    : nextEpisodeRow(request.seriesId, newest, entry),
        },
        fullyWatched: false,
    };
}

export function matchesStalkerSeriesPosition(
    position: PlaybackPositionData,
    mode: DashboardStalkerSeriesMode,
    parentId: string | number | undefined
): boolean {
    const identity = position.activityIdentity;
    return (
        !identity ||
        (identity.provider === 'stalker' &&
            identity.kind === 'episode' &&
            identity.mode === mode &&
            identity.seriesId === String(parentId))
    );
}

/** Reject incomplete catalog shapes and ambiguous tracking ids. */
function listedEpisodeIds(
    seasons: Readonly<Record<string, readonly XtreamSerieEpisode[]>>
): Set<number> | null {
    if (!seasons || typeof seasons !== 'object' || Array.isArray(seasons)) {
        return null;
    }
    const ids = new Set<number>();
    for (const episodes of Object.values(seasons)) {
        if (!Array.isArray(episodes)) {
            return null;
        }
        for (const episode of episodes) {
            const id = toEpisodeNumber(episode?.id);
            if (
                id === null ||
                id === 0 ||
                ids.has(id) ||
                toEpisodeNumber(episode?.episode_num) === null
            ) {
                return null;
            }
            ids.add(id);
        }
    }
    return ids;
}

/** The row an episode not started yet stands for: 0:00 and no progress. */
function nextEpisodeRow(
    seriesId: number,
    newest: PlaybackPositionData,
    entry: SeriesEpisodeEntry
): PlaybackPositionData {
    const seasonNumber = toEpisodeNumber(entry.seasonNumber);
    const episodeNumber = toEpisodeNumber(entry.episode.episode_num);
    return {
        contentXtreamId: Number(entry.episode.id),
        contentType: 'episode',
        seriesXtreamId: seriesId,
        ...(seasonNumber !== null && episodeNumber !== null
            ? { seasonNumber, episodeNumber }
            : {}),
        positionSeconds: 0,
        playlistId: newest.playlistId,
        updatedAt: newest.updatedAt,
        ...(entry.episode.activityIdentity
            ? { activityIdentity: entry.episode.activityIdentity }
            : {}),
    };
}

function toEpisodeNumber(value: unknown): number | null {
    if (
        (typeof value !== 'number' && typeof value !== 'string') ||
        String(value).trim() === ''
    ) {
        return null;
    }
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
