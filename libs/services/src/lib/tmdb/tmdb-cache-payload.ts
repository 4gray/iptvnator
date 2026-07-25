import { TmdbDetails, TmdbTvDetails } from './tmdb.types';

/**
 * Trims a details payload before it is cached.
 *
 * `aggregate_credits` spans a show's whole run: for a long-running series
 * that is hundreds of cast entries — each with its own `roles[]` — plus a
 * crew list that can run into the thousands. The merge reads only the
 * top-billed cast, so caching the rest verbatim grows `tmdb_metadata` (and
 * the PWA's in-memory map) by orders of magnitude for data nothing reads.
 *
 * The cast kept here is the billing-order prefix, so every consumer that
 * takes a top-N by `order` sees exactly what it would have seen from the
 * full payload. Everything else is passed through untouched — payloads
 * still hold whatever a later phase might want without a refetch.
 */

/**
 * Comfortably above the merge's own ceiling (10 names + 3 reserved slots
 * for newest-season arrivals), so trimming can never change the result.
 */
const CACHED_AGGREGATE_CAST_LIMIT = 40;

export function trimDetailsForCache(details: TmdbDetails): TmdbDetails {
    const aggregate = (details as TmdbTvDetails).aggregate_credits;
    if (!aggregate) {
        return details;
    }

    const cast = [...(aggregate.cast ?? [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .slice(0, CACHED_AGGREGATE_CAST_LIMIT);

    // `crew` is dropped rather than trimmed: series credits come from
    // `created_by`, so nothing reads the aggregate crew at all.
    return { ...details, aggregate_credits: { cast } } as TmdbDetails;
}
