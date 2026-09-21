import { hashM3uId } from '@iptvnator/shared/interfaces';
import {
    M3uArtworkBearing,
    M3uSeriesAccumulator,
    M3uSeriesEpisode,
} from './m3u-series-model';

/**
 * The stage that decides which same-titled series are actually remakes.
 *
 * It runs after every row has been filed, because the question cannot be
 * answered one row at a time: whether "SHOW" and "SHOW 2025" are one series
 * or two depends on how many distinct years the whole catalog states for
 * that title.
 */

/**
 * Decides which year-separated accumulators are actually one series.
 *
 * Rows arrive keyed by title AND stated year, because a duplicate
 * season×episode is collapsed into one episode the moment it is added — so
 * two remakes sharing a title would have merged before anything could tell
 * them apart.
 *
 * Merging back is what keeps "SHOW 2025" together with its unyeared
 * siblings, which real providers write constantly. It happens only when at
 * most ONE year is stated for the title: two stated years are remakes, and
 * leaving them merged attaches one show's watch progress and TMDB match to
 * the other. When a conflict exists, rows carrying no year stay their own
 * series, because there is no honest way to guess which remake they belong
 * to.
 */
export function regroupM3uSeriesByYear<T extends M3uArtworkBearing>(
    accumulators: Iterable<M3uSeriesAccumulator<T>>
): M3uSeriesAccumulator<T>[] {
    const byBase = new Map<string, M3uSeriesAccumulator<T>[]>();
    for (const series of accumulators) {
        const existing = byBase.get(series.baseKey);
        if (existing) {
            existing.push(series);
        } else {
            byBase.set(series.baseKey, [series]);
        }
    }

    const result: M3uSeriesAccumulator<T>[] = [];

    for (const [baseKey, parts] of byBase) {
        const yeared = parts.filter((part) => part.yearHint !== null);

        if (yeared.length >= 2) {
            // Remakes. Each keeps its year-qualified key, so its episode
            // ids stay its own.
            result.push(...parts);
            continue;
        }

        // One year at most: one series, keyed without the year so its ids
        // do not move when a provider later adds or drops the tag.
        result.push(mergeParts(baseKey, parts));
    }

    return result;
}

/** Ids follow the final key, or two series would share watch history. */
export function remintM3uEpisodeIds<T extends M3uArtworkBearing>(
    series: M3uSeriesAccumulator<T>
): void {
    for (const [, episodes] of series.seasons) {
        for (const [number, episode] of episodes) {
            episodes.set(number, {
                ...episode,
                id: hashM3uId(
                    `${series.key}\u0000${episode.seasonNumber}x${episode.episodeNumber}`
                ),
            });
        }
    }
}

function mergeParts<T extends M3uArtworkBearing>(
    baseKey: string,
    parts: M3uSeriesAccumulator<T>[]
): M3uSeriesAccumulator<T> {
    const merged: M3uSeriesAccumulator<T> = {
        ...parts[0],
        key: baseKey,
        seasons: new Map(),
    };

    for (const part of parts) {
        merged.yearHint ??= part.yearHint;
        merged.posterUrl ??= part.posterUrl;
        for (const [number, episodes] of part.seasons) {
            for (const [episodeNumber, episode] of episodes) {
                addMergedEpisode(merged, number, episodeNumber, episode);
            }
        }
    }

    return merged;
}

function addMergedEpisode<T extends M3uArtworkBearing>(
    merged: M3uSeriesAccumulator<T>,
    seasonNumber: number,
    episodeNumber: number,
    episode: M3uSeriesEpisode<T>
): void {
    let season = merged.seasons.get(seasonNumber);
    if (!season) {
        season = new Map();
        merged.seasons.set(seasonNumber, season);
    }

    const existing = season.get(episodeNumber);
    season.set(
        episodeNumber,
        existing
            ? {
                  ...existing,
                  alternatives: [
                      ...existing.alternatives,
                      episode.channel,
                      ...episode.alternatives,
                  ],
              }
            : episode
    );
}
