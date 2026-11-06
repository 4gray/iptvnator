import {
    isExtrasSeason,
    isPortalPlaybackInProgress,
} from '@iptvnator/portal/shared/util';
import {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';

export interface AutoSeasonContext {
    /** Season keys in display order. */
    keys: readonly string[];
    /** Season of the inline-playing episode, if it is in the loaded set. */
    playingSeasonKey: string | null;
    seasons: Record<string, XtreamSerieEpisode[]>;
    positionOf: (
        episode: XtreamSerieEpisode
    ) => PlaybackPositionData | undefined;
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
 * playback positions change: the inline-playing episode's season, else the
 * most recently updated in-progress episode's season, else the default
 * fallback below. Extras (season 0) steer neither of the last two while the
 * series' other seasons hold, or may still hold, episodes, as with the
 * series' next episode (`getSeriesNextUp`). Pure, so the container's auto-select effect stays a
 * thin wrapper (see `SeasonContainerComponent.selectedSeason`).
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
    return (
        findMostRecentInProgressSeason(context, steering) ??
        resolveDefaultSeason(context, steering, unloaded)
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
    { hasUnloadedSeasons, episodeCounts, watchedCounts }: AutoSeasonContext,
    keys: readonly string[],
    unloaded: ReadonlySet<string>
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

function findMostRecentInProgressSeason(
    { seasons, positionOf }: AutoSeasonContext,
    keys: readonly string[]
): string | null {
    let bestSeason: string | null = null;
    let bestUpdatedAt = '';
    for (const [key, episodes] of Object.entries(seasons)) {
        if (!keys.includes(key)) {
            continue;
        }
        for (const episode of episodes ?? []) {
            const position = positionOf(episode);
            if (!isPortalPlaybackInProgress(position)) {
                continue;
            }
            const updatedAt = position?.updatedAt ?? '';
            if (updatedAt >= bestUpdatedAt) {
                bestUpdatedAt = updatedAt;
                bestSeason = key;
            }
        }
    }
    return bestSeason;
}
