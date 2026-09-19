import { isPortalPlaybackInProgress } from '@iptvnator/portal/shared/util';
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
    episodeCounts: Record<string, number>;
    watchedCounts: Record<string, number>;
}

/**
 * The season the container opens on when the season set or the initial
 * playback positions change: the inline-playing episode's season, else the
 * most recently updated in-progress episode's season, else the default
 * fallback below. Pure, so the container's auto-select effect stays a thin
 * wrapper (see `SeasonContainerComponent.selectedSeason`).
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
    return (
        findMostRecentInProgressSeason(context) ?? resolveDefaultSeason(context)
    );
}

/**
 * Fallback when nothing is playing or in progress: the earliest season with
 * unwatched episodes, or — once everything loaded is watched — the latest
 * non-empty season, where new episodes land (issue #1441). Loaded-but-empty
 * seasons (a valid Stalker answer) are never picked over one that has
 * episodes. Stalker lazy-VOD series with unhydrated seasons keep the first
 * season: their watched state is unknown, so skipping past them would be a
 * guess.
 */
function resolveDefaultSeason({
    keys,
    hasUnloadedSeasons,
    episodeCounts,
    watchedCounts,
}: AutoSeasonContext): string {
    if (hasUnloadedSeasons) {
        return keys[0];
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

function findMostRecentInProgressSeason({
    seasons,
    positionOf,
}: AutoSeasonContext): string | null {
    let bestSeason: string | null = null;
    let bestUpdatedAt = '';
    for (const [key, episodes] of Object.entries(seasons)) {
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
