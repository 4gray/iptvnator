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
            // Remakes. Each keeps its own ids, but the earliest keeps the
            // year-free key the title had while it was the only one: a
            // remake is almost always the newcomer, and without this its
            // arrival in a refresh would re-mint the original's episode ids
            // and orphan every watched mark and resume point stored under
            // them. The rarer reverse order — an older original added after
            // its remake — still moves the remake's ids; keeping both
            // stable would need the previous catalog, which is not stored.
            const original = earliestStatedYear(yeared);
            result.push(
                ...parts.map((part) =>
                    part === original ? { ...part, key: baseKey } : part
                )
            );
            continue;
        }

        // One year at most: one series, keyed without the year so its ids
        // do not move when a provider later adds or drops the tag.
        result.push(mergeParts(baseKey, parts));
    }

    return result;
}

function earliestStatedYear<T extends M3uArtworkBearing>(
    yeared: readonly M3uSeriesAccumulator<T>[]
): M3uSeriesAccumulator<T> {
    return yeared.reduce((earliest, part) =>
        Number(part.yearHint) < Number(earliest.yearHint) ? part : earliest
    );
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
        // Fresh containers rather than the ones spread in from `parts[0]`:
        // every part contributes to them below, and mutating the first
        // part's own array and maps would rewrite an input.
        groups: [],
        groupCounts: new Map(),
        seasons: new Map(),
    };

    for (const part of parts) {
        merged.yearHint ??= part.yearHint;
        merged.posterUrl ??= part.posterUrl;
        // Group membership has to merge too. `finalize` picks the primary
        // group by episode count, so keeping only the first part's tally
        // files a series under whichever spelling of its title happened to
        // be read first — which is not necessarily where most of its
        // episodes live.
        for (const group of part.groups) {
            if (!merged.groupCounts.has(group)) {
                merged.groups.push(group);
            }
            merged.groupCounts.set(
                group,
                (merged.groupCounts.get(group) ?? 0) +
                    (part.groupCounts.get(group) ?? 0)
            );
        }
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
