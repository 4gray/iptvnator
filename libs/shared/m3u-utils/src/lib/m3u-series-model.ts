import { M3uCatalogEntry } from './m3u-catalog-index.util';

/**
 * The shapes the series layer is built from.
 *
 * They live apart from the aggregation itself because two stages need
 * them: the pass that accumulates rows into series, and the pass that
 * decides which of those accumulators are remakes of one another. Keeping
 * the model here lets each stage import it without importing the other.
 */

export interface M3uSeriesEpisode<T> {
    /**
     * Stable numeric id, keyed on the series and the season×episode — or,
     * for a row that states no number, on the series and `rowKey`.
     */
    readonly id: number;
    /**
     * Set when the id cannot come from the coordinates: the file name the
     * row's URL ends in. That is a row with no number, whose
     * `episodeNumber` is just its slot in the list, and a second row at a
     * coordinate another row already holds.
     */
    readonly rowKey?: string;
    /** True when `episodeNumber` is a slot, not a number the row states. */
    readonly unnumbered?: boolean;
    readonly seasonNumber: number;
    readonly episodeNumber: number;
    /** The tail the provider wrote after the marker, when there was one. */
    readonly title: string | null;
    readonly channel: T;
    /**
     * The same URL listed again. A row with another URL is never kept
     * here: nothing plays an alternative, so it is listed as an entry of
     * its own instead.
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

/** The mutable form a series takes while rows are still being added. */
export interface M3uSeriesAccumulator<T> {
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

/** A catalog row that may carry artwork, which the series poster reads. */
export type M3uArtworkBearing = M3uCatalogEntry & {
    readonly tvg?: { readonly logo?: string | null } | null;
};
