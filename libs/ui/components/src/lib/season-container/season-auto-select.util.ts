import {
    compareSeriesEpisodes,
    getSeriesNextUp,
    isExtrasSeason,
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
} from '@iptvnator/portal/shared/util';
import {
    playbackTimestamp,
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';

export interface AutoSeasonContext {
    /** Season keys in display order. */
    keys: readonly string[];
    /** Season of the inline-playing episode, if it is in the loaded set. */
    playingSeasonKey: string | null;
    seasons: Record<string, XtreamSerieEpisode[]>;
    playbackPositions: ReadonlyMap<number, PlaybackPositionData>;
    /** Stalker lazy-VOD: some seasons' episode lists are not loaded yet. */
    hasUnloadedSeasons: boolean;
    /**
     * Stalker lazy-VOD: the seasons whose lists are not loaded yet (pending
     * or loading). `hasUnloadedSeasons` alone cannot tell one of them from a
     * season the portal answered empty.
     */
    unloadedSeasonKeys?: readonly string[];
    episodeCounts: Record<string, number>;
    watchedCounts: Record<string, number>;
}

/**
 * The season the container opens on when the season set or the initial
 * playback positions change. Prefer the inline-playing episode, then the
 * latest unfinished activity (including short launches), then look for
 * saved progress or the season after the last watched episode. Extras
 * (season 0) are skipped while regular seasons have episodes or are pending.
 */
export function resolveAutoSelectedSeason(
    context: AutoSeasonContext
): string | undefined {
    const { keys } = context;
    if (keys.length === 0) {
        return undefined;
    }
    if (context.playingSeasonKey) {
        return context.playingSeasonKey;
    }
    const unloaded = new Set(context.unloadedSeasonKeys ?? []);
    const runKeys = keys.filter(
        (key) => !isExtrasSeason(key, context.seasons[key])
    );
    // A run that came back empty does not hide the extras; one still to
    // load may. Without per-season states the aggregate flag stands in.
    const runMayHaveEpisodes =
        runKeys.some(
            (key) => unloaded.has(key) || (context.episodeCounts[key] ?? 0) > 0
        ) ||
        (unloaded.size === 0 && context.hasUnloadedSeasons);
    const steering = runKeys.length > 0 && runMayHaveEpisodes ? runKeys : keys;
    const pendingUnknown = unloaded.size === 0 && context.hasUnloadedSeasons;
    return (
        findLatestUnfinishedSeason(context, steering) ??
        findMostRecentInProgressSeason(context, steering) ??
        findNextAfterLastWatchedSeason(
            context,
            steering,
            unloaded,
            pendingUnknown
        ) ??
        resolveDefaultSeason(
            context,
            steering,
            unloaded,
            pendingUnknown || steering.some((key) => unloaded.has(key))
        )
    );
}

/**
 * Fallback when nothing is playing or in progress: the earliest season with
 * unwatched episodes, or — once everything loaded is watched — the latest
 * non-empty season, where new episodes land (issue #1441). Loaded-but-empty
 * seasons (a valid Stalker answer) are never picked over one that has
 * episodes. Stalker lazy-VOD series with unhydrated seasons keep the first
 * season still to load or holding episodes: the watched state of a pending
 * season is unknown, so skipping past it would be a guess, while a season
 * answered empty before it has nothing to show.
 */
function resolveDefaultSeason(
    { episodeCounts, watchedCounts }: AutoSeasonContext,
    keys: readonly string[],
    unloaded: ReadonlySet<string>,
    hasUnloadedSeasons: boolean
): string {
    if (hasUnloadedSeasons) {
        return (
            keys.find(
                (key) => unloaded.has(key) || (episodeCounts[key] ?? 0) > 0
            ) ?? keys[0]
        );
    }
    const firstUnwatched = keys.find((key) => {
        const total = episodeCounts[key] ?? 0;
        return total > 0 && (watchedCounts[key] ?? 0) < total;
    });
    if (firstUnwatched) {
        return firstUnwatched;
    }
    const latestWithEpisodes = [...keys]
        .reverse()
        .find((key) => (episodeCounts[key] ?? 0) > 0);
    return latestWithEpisodes ?? keys[0];
}

function findLatestUnfinishedSeason(
    { seasons, playbackPositions }: AutoSeasonContext,
    keys: readonly string[]
): string | undefined {
    if (playbackPositions.size === 0) {
        return undefined;
    }
    const eligibleSeasons: typeof seasons = Object.create(null);
    for (const key of keys) {
        eligibleSeasons[key] = seasons[key] ?? [];
    }
    const nextUp = getSeriesNextUp({
        seasons: eligibleSeasons,
        playbackPositions,
    });
    if (nextUp?.kind === 'resume') {
        return keys.find((key) => seasons[key]?.includes(nextUp.entry.episode));
    }
    return undefined;
}

function findMostRecentInProgressSeason(
    { seasons, playbackPositions }: AutoSeasonContext,
    keys: readonly string[]
): string | null {
    let bestSeason: string | null = null;
    let bestUpdatedAt = -Infinity;
    for (const key of keys) {
        for (const episode of seasons[key] ?? []) {
            const position = playbackPositions.get(Number(episode.id));
            if (!isPortalPlaybackInProgress(position)) {
                continue;
            }
            const updatedAt = playbackTimestamp(position?.updatedAt);
            if (updatedAt >= bestUpdatedAt) {
                bestUpdatedAt = updatedAt;
                bestSeason = key;
            }
        }
    }
    return bestSeason;
}

/**
 * Season of the first unwatched episode after the episode watched last, so
 * skipping ahead to a later season (e.g. watching S04E01–S04E02 with
 * seasons 1–3 untouched) keeps the container on season 4 instead of falling
 * back to season 1.
 */
function findNextAfterLastWatchedSeason(
    {
        seasons,
        playbackPositions,
        episodeCounts,
        watchedCounts,
    }: AutoSeasonContext,
    keys: readonly string[],
    unloaded: ReadonlySet<string>,
    pendingUnknown: boolean
): string | null {
    let lastWatchedKey: string | null = null;
    let lastWatchedEpisodes: XtreamSerieEpisode[] = [];
    let lastWatchedIndex = -1;
    let bestUpdatedAt = -Infinity;
    for (const key of keys) {
        const episodes = [...(seasons[key] ?? [])].sort(compareSeriesEpisodes);
        for (const [index, episode] of episodes.entries()) {
            const position = playbackPositions.get(Number(episode.id));
            if (!isPortalPlaybackWatched(position)) {
                continue;
            }
            const updatedAt = playbackTimestamp(position?.updatedAt);
            if (updatedAt >= bestUpdatedAt) {
                bestUpdatedAt = updatedAt;
                lastWatchedKey = key;
                lastWatchedEpisodes = episodes;
                lastWatchedIndex = index;
            }
        }
    }
    if (!lastWatchedKey) {
        return null;
    }
    if (
        lastWatchedEpisodes
            .slice(lastWatchedIndex + 1)
            .some(
                (episode) =>
                    !isPortalPlaybackWatched(
                        playbackPositions.get(Number(episode.id))
                    )
            )
    ) {
        return lastWatchedKey;
    }
    if (pendingUnknown) {
        return null;
    }
    return (
        keys
            .slice(keys.indexOf(lastWatchedKey) + 1)
            .find(
                (key) =>
                    unloaded.has(key) ||
                    (watchedCounts[key] ?? 0) < (episodeCounts[key] ?? 0)
            ) ?? null
    );
}
