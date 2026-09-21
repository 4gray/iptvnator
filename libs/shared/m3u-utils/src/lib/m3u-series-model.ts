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
