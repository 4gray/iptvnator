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
            // its remake — is worse than a move: the original takes the
            // year-free key, so it shows the remake's watched marks and
            // resume points, and the remake starts empty. Rows with no year
            // also leave the merged series once a second year appears, so
            // coordinates only they carried lose their progress. Keeping
            // every case stable would need the previous catalog, which is
            // not stored.
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

/**
 * The one place an episode id is derived. A numbered episode is keyed on
 * its coordinates; a row with no number on its `rowKey`, because its slot
 * is not stable.
 */
export function mintM3uEpisodeId(
    seriesKey: string,
    episode: {
        readonly seasonNumber: number;
        readonly episodeNumber: number;
        readonly rowKey?: string;
    }
): number {
    return hashM3uId(
        episode.rowKey === undefined
            ? `${seriesKey}\u0000${episode.seasonNumber}x${episode.episodeNumber}`
            : `${seriesKey}\u0000row\u0000${episode.rowKey}`
    );
}

/**
 * Ids follow the final key, or two series would share watch history.
 *
 * Unnumbered rows of one series can end in the same file name (two
 * `index.m3u8` under different directories). Nothing stable tells those
 * apart, and numbering them by playlist order would swap their watch
 * history on a reorder. They are keyed on their whole URL instead: a
 * rotated token then drops the mark rather than moving it to another
 * episode. Rows with a file name of their own are unaffected.
 */
export function remintM3uEpisodeIds<T extends M3uArtworkBearing>(
    series: M3uSeriesAccumulator<T>
): void {
    const rowKeyUses = new Map<string, number>();
    for (const [, episodes] of series.seasons) {
        for (const [, episode] of episodes) {
            if (episode.rowKey !== undefined) {
                rowKeyUses.set(
                    episode.rowKey,
                    (rowKeyUses.get(episode.rowKey) ?? 0) + 1
                );
            }
        }
    }

    for (const [, episodes] of series.seasons) {
        for (const [number, episode] of episodes) {
            const shared =
                episode.rowKey !== undefined &&
                (rowKeyUses.get(episode.rowKey) ?? 0) > 1;
            episodes.set(number, {
                ...episode,
                id: mintM3uEpisodeId(
                    series.key,
                    shared
                        ? {
                              ...episode,
                              rowKey: `${episode.rowKey}\u0000${episode.channel.url}`,
                          }
                        : episode
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
    if (!existing) {
        season.set(episodeNumber, episode);
        return;
    }

    // A slot held by, or wanted by, a row with no number is not a
    // coordinate two rows agree on: "Show" and "Show 2025" each list their
    // first unnumbered row at slot 1. Parking one under the other would
    // hide a different file, so the unnumbered one moves instead and the
    // numbered episode keeps the coordinate it states.
    if (episode.rowKey !== undefined) {
        placeUnnumberedEpisode(season, episode);
        return;
    }
    if (existing.rowKey !== undefined) {
        season.set(episodeNumber, episode);
        placeUnnumberedEpisode(season, existing);
        return;
    }

    season.set(episodeNumber, {
        ...existing,
        alternatives: [
            ...existing.alternatives,
            episode.channel,
            ...episode.alternatives,
        ],
    });
}

/**
 * Lists an unnumbered row at the next free slot of its season. The same
 * URL again is the same row and is parked.
 */
export function placeUnnumberedEpisode<T extends M3uArtworkBearing>(
    season: Map<number, M3uSeriesEpisode<T>>,
    episode: M3uSeriesEpisode<T>
): void {
    let last = 0;
    for (const [number, existing] of season) {
        if (existing.channel.url === episode.channel.url) {
            season.set(number, {
                ...existing,
                alternatives: [
                    ...existing.alternatives,
                    episode.channel,
                    ...episode.alternatives,
                ],
            });
            return;
        }
        last = Math.max(last, number);
    }

    season.set(last + 1, { ...episode, episodeNumber: last + 1 });
}
