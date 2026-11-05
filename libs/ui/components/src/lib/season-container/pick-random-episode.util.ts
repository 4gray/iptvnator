import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';

/**
 * Picks a uniformly random episode from across all seasons of a series.
 *
 * @param seasons episodes grouped by season key, as held by the season container
 * @param random source of randomness in [0, 1); injectable for deterministic tests
 * @returns a random episode, or undefined when the series has no episodes
 */
export function pickRandomEpisode(
    seasons: Record<string, XtreamSerieEpisode[]>,
    random: () => number = Math.random
): XtreamSerieEpisode | undefined {
    const episodes = Object.values(seasons ?? {})
        .filter((list): list is XtreamSerieEpisode[] => Array.isArray(list))
        .flat();

    if (episodes.length === 0) {
        return undefined;
    }

    // Clamp guards against random() returning exactly 1 (out of spec) or float error.
    const index = Math.min(
        Math.floor(random() * episodes.length),
        episodes.length - 1
    );
    return episodes[index];
}
