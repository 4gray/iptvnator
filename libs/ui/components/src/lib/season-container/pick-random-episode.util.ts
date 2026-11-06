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

/** What the shuffle should do next: play an episode, or load a season first. */
export type RandomEpisodePick =
    | { kind: 'episode'; episode: XtreamSerieEpisode }
    | { kind: 'season'; seasonKey: string };

/**
 * Picks a random episode across loaded and not-yet-loaded seasons (Stalker
 * lazy-VOD). A loaded season counts once per episode. A season whose list is
 * not loaded yet counts as many times as the average loaded season, since its
 * size is unknown, so every season has a fair chance. When an unloaded season
 * wins, the caller loads it and then picks an episode from it.
 *
 * @param seasons episodes grouped by season key, as held by the season container
 * @param unloadedSeasonKeys seasons whose episode lists are not loaded yet
 * @param random source of randomness in [0, 1); injectable for deterministic tests
 * @returns an episode to play, a season to load first, or undefined when there is nothing to pick
 */
export function pickRandomEpisodeOrSeason(
    seasons: Record<string, XtreamSerieEpisode[]>,
    unloadedSeasonKeys: readonly string[],
    random: () => number = Math.random
): RandomEpisodePick | undefined {
    const unloaded = new Set(unloadedSeasonKeys);
    const loaded = Object.entries(seasons ?? {}).filter(
        ([key, list]) =>
            !unloaded.has(key) && Array.isArray(list) && list.length > 0
    );

    if (unloaded.size === 0) {
        const episode = pickRandomEpisode(seasons, random);
        return episode ? { kind: 'episode', episode } : undefined;
    }

    const loadedTotal = loaded.reduce((sum, [, list]) => sum + list.length, 0);
    const unloadedWeight = loaded.length > 0 ? loadedTotal / loaded.length : 1;
    const total = loadedTotal + unloadedWeight * unloaded.size;

    let draw = random() * total;
    for (const [, list] of loaded) {
        if (draw < list.length) {
            return { kind: 'episode', episode: list[Math.floor(draw)] };
        }
        draw -= list.length;
    }

    const unloadedKeys = [...unloaded];
    // Clamp guards against random() returning exactly 1 (out of spec) or float error.
    const index = Math.min(
        Math.floor(draw / unloadedWeight),
        unloadedKeys.length - 1
    );
    return { kind: 'season', seasonKey: unloadedKeys[index] };
}
