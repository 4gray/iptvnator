import { hashM3uId, normalizeTitleKeys } from '@iptvnator/shared/interfaces';
import { M3uCatalogEntry } from './m3u-catalog-index.util';
import { M3uEpisodeParse, parseM3uEpisode } from './m3u-episode-parse.util';
import { hasEpisodeMarker } from './m3u-vod-detection.util';
import { splitM3uNameTag } from './m3u-name-tag.util';

/**
 * Collapses episode rows into series.
 *
 * On the playlist this was built against, 40,327 rows become 1,953 series
 * with every row placed. That ratio is the whole feature: a viewer browsing
 * a series catalog is looking for a show, not for the 430 rows one show
 * occupies in a flat list.
 *
 * The model is portal-neutral on purpose. Converting it into the shape the
 * shared season components expect is the job of an adapter in the feature
 * library, next to its only consumer — the Xtream episode shape is a UI
 * contract, not a property of an M3U playlist, and keeping it out of here
 * lets this module import contracts only.
 */

export interface M3uSeriesEpisode<T> {
    /** Stable numeric id, keyed on the series and the season×episode. */
    readonly id: number;
    readonly seasonNumber: number;
    readonly episodeNumber: number;
    /** The tail the provider wrote after the marker, when there was one. */
    readonly title: string | null;
    readonly channel: T;
    /**
     * Further rows that resolved to the same season×episode — typically the
     * same episode at another quality. The first one wins; the rest are kept
     * so a future quality picker has somewhere to read them from, and so
     * they are not silently lost.
     */
    readonly alternatives: readonly T[];
}

export interface M3uSeries<T> {
    /** Identity key; stable across refreshes for the same playlist. */
    readonly key: string;
    readonly id: number;
    /** Display title: language tag removed. */
    readonly title: string;
    /** Title as the provider wrote it, tag included. */
    readonly rawTitle: string;
    readonly languageTag: string | null;
    /** Trailing year the normalizer stripped, if any — a TMDB match hint. */
    readonly yearHint: number | null;
    /** Every group this series' episodes appeared in, in first-seen order. */
    readonly groups: readonly string[];
    /** The group holding most of its episodes. */
    readonly primaryGroup: string;
    readonly seasons: ReadonlyMap<number, readonly M3uSeriesEpisode<T>[]>;
    readonly episodeCount: number;
    /** First artwork any of its episodes carried. */
    readonly posterUrl: string | null;
}

interface SeriesAccumulator<T> {
    key: string;
    /** Title identity without the year, for the regroup step. */
    baseKey: string;
    title: string;
    rawTitle: string;
    languageTag: string | null;
    yearHint: number | null;
    groups: string[];
    groupCounts: Map<string, number>;
    seasons: Map<number, Map<number, M3uSeriesEpisode<T>>>;
    posterUrl: string | null;
}

type ArtworkBearing = M3uCatalogEntry & {
    readonly tvg?: { readonly logo?: string | null } | null;
};

/**
 * Builds the series list from rows already classified as episodes.
 *
 * `playlistId` is part of every key because the parser mints a fresh random
 * id on each import, so nothing about a row is stable across playlists
 * anyway — and two playlists holding the same show are two catalogs, not
 * one, until cross-playlist merging exists.
 */
export function buildM3uSeriesCatalog<T extends ArtworkBearing>(
    episodes: readonly T[] | null | undefined,
    playlistId: string
): readonly M3uSeries<T>[] {
    const accumulators = new Map<string, SeriesAccumulator<T>>();

    for (const channel of episodes ?? []) {
        // A row classified as an episode whose name carries NO marker at
        // all still exists and still plays. Dropping it would make provider
        // content vanish from the catalog with no trace — worse than the
        // alternative, a one-episode series named after the row. If the
        // parser later learns that spelling, such rows collapse into their
        // real series on the next load.
        //
        // A name that is nothing BUT a marker ("S01E01") is the other case
        // and is still skipped: there is no series name in it to file it
        // under, and taking the marker as the title would produce one
        // phantom series per episode.
        const parsed =
            parseM3uEpisode(channel.name) ??
            (hasEpisodeMarker(channel.name)
                ? null
                : {
                      seriesTitle: (channel.name ?? '').trim(),
                      seasonNumber: 1,
                      episodeNumber: 1,
                      hasExplicitSeason: false,
                      episodeTitle: null,
                  });
        if (!parsed) {
            continue;
        }

        const { tag, title } = splitM3uNameTag(parsed.seriesTitle);
        const keys = normalizeTitleKeys(title);
        if (!keys.base) {
            // Nothing identifying survives normalization — a row named only
            // by punctuation or a bare tag. There is no series it could be
            // filed under.
            continue;
        }

        // The tag is IN the key. "TR:MODERN FAMILY" and "DE:MODERN FAMILY"
        // are one show in two dubs; merging them interleaves two audio
        // languages inside a single season and leaves S1E1 ambiguous.
        //
        // The year is NOT in the key, so a yeared title still merges with
        // an unyeared one. Two DIFFERENT stated years are a different
        // matter — remakes — and are separated afterwards, once the whole
        // catalog is known; that cannot be decided one row at a time.
        const baseKey = `${playlistId}\u0000${tag ?? ''}\u0000${keys.base}`;
        const year = keys.trailingYear;
        const key = `${baseKey}\u0000${year ?? ''}`;

        let series = accumulators.get(key);
        if (!series) {
            series = {
                key,
                baseKey,
                title,
                rawTitle: parsed.seriesTitle,
                languageTag: tag,
                yearHint: keys.trailingYear,
                groups: [],
                groupCounts: new Map(),
                seasons: new Map(),
                posterUrl: null,
            };
            accumulators.set(key, series);
        }

        recordGroup(series, channel.group?.title ?? '');
        series.posterUrl ??= channel.tvg?.logo || null;
        series.yearHint ??= keys.trailingYear;

        addEpisode(series, channel, parsed);
    }

    return regroupByYear(accumulators.values()).map((series) => {
        remintEpisodeIds(series);
        return finalize(series);
    });
}

function recordGroup<T>(series: SeriesAccumulator<T>, title: string): void {
    if (!series.groupCounts.has(title)) {
        series.groups.push(title);
    }
    series.groupCounts.set(title, (series.groupCounts.get(title) ?? 0) + 1);
}

function addEpisode<T extends ArtworkBearing>(
    series: SeriesAccumulator<T>,
    channel: T,
    parsed: M3uEpisodeParse
): void {
    const { seasonNumber, episodeNumber } = parsed;
    let season = series.seasons.get(seasonNumber);
    if (!season) {
        season = new Map();
        series.seasons.set(seasonNumber, season);
    }

    const existing = season.get(episodeNumber);
    if (existing) {
        // A duplicate season×episode is the same episode at another
        // quality. Keeping the first and parking the rest is what lets the
        // id be derived from the coordinates rather than from a URL that
        // providers rotate on every refresh.
        season.set(episodeNumber, {
            ...existing,
            alternatives: [...existing.alternatives, channel],
        });
        return;
    }

    season.set(episodeNumber, {
        id: hashM3uId(`${series.key}\u0000${seasonNumber}x${episodeNumber}`),
        seasonNumber,
        episodeNumber,
        title: parsed.episodeTitle,
        channel,
        alternatives: [],
    });
}

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
function regroupByYear<T extends ArtworkBearing>(
    accumulators: Iterable<SeriesAccumulator<T>>
): SeriesAccumulator<T>[] {
    const byBase = new Map<string, SeriesAccumulator<T>[]>();
    for (const series of accumulators) {
        const existing = byBase.get(series.baseKey);
        if (existing) {
            existing.push(series);
        } else {
            byBase.set(series.baseKey, [series]);
        }
    }

    const result: SeriesAccumulator<T>[] = [];

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

function mergeParts<T extends ArtworkBearing>(
    baseKey: string,
    parts: SeriesAccumulator<T>[]
): SeriesAccumulator<T> {
    const merged: SeriesAccumulator<T> = {
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

function addMergedEpisode<T extends ArtworkBearing>(
    merged: SeriesAccumulator<T>,
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

/** Ids follow the final key, or two series would share watch history. */
function remintEpisodeIds<T extends ArtworkBearing>(
    series: SeriesAccumulator<T>
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

function finalize<T extends ArtworkBearing>(
    series: SeriesAccumulator<T>
): M3uSeries<T> {
    const seasons = new Map<number, readonly M3uSeriesEpisode<T>[]>();
    let episodeCount = 0;

    for (const number of [...series.seasons.keys()].sort((a, b) => a - b)) {
        const episodes = [...(series.seasons.get(number)?.values() ?? [])].sort(
            (a, b) => a.episodeNumber - b.episodeNumber
        );
        seasons.set(number, episodes);
        episodeCount += episodes.length;
    }

    let primaryGroup = '';
    let best = -1;
    for (const group of series.groups) {
        const count = series.groupCounts.get(group) ?? 0;
        if (count > best) {
            best = count;
            primaryGroup = group;
        }
    }

    return {
        key: series.key,
        id: hashM3uId(series.key),
        title: series.title,
        rawTitle: series.rawTitle,
        languageTag: series.languageTag,
        yearHint: series.yearHint,
        groups: series.groups,
        primaryGroup,
        seasons,
        episodeCount,
        posterUrl: series.posterUrl,
    };
}
