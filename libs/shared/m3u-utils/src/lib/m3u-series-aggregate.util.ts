import { hashM3uId, normalizeTitleKeys } from '@iptvnator/shared/interfaces';
import { M3uCatalogEntry } from './m3u-catalog-index.util';
import { M3uEpisodeParse, parseM3uEpisode } from './m3u-episode-parse.util';
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
        const parsed = parseM3uEpisode(channel.name);
        if (!parsed) {
            continue;
        }

        const { tag, title } = splitM3uNameTag(parsed.seriesTitle);
        const keys = normalizeTitleKeys(title);
        if (!keys.base) {
            continue;
        }

        // The tag is IN the key. "TR:MODERN FAMILY" and "DE:MODERN FAMILY"
        // are one show in two dubs; merging them interleaves two audio
        // languages inside a single season and leaves S1E1 ambiguous.
        const key = `${playlistId}\u0000${tag ?? ''}\u0000${keys.base}`;

        let series = accumulators.get(key);
        if (!series) {
            series = {
                key,
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

    return [...accumulators.values()].map((series) => finalize(series));
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
