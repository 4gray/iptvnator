import { TmdbDetails, TmdbTvDetails } from './tmdb.types';

/**
 * Trims a details payload before it is cached.
 *
 * `aggregate_credits` spans a show's whole run: a crew list that can reach
 * into the thousands, plus every cast member carrying one `roles[]` entry
 * per character they ever played. Caching that verbatim grows
 * `tmdb_metadata` (and the PWA's in-memory map) by orders of magnitude for
 * data nothing reads.
 *
 * What goes is chosen so that a merge over the trimmed payload produces
 * exactly what a merge over the full one would:
 *
 * - the whole cast stays, ids included. It is the only record of who was
 *   in the show before the newest season, so dropping the tail would make
 *   a returning actor read as a new arrival on the cached path — the
 *   displayed cast would then differ between the first render and every
 *   later one.
 * - `roles[]` keeps only the character with the most episodes, which is
 *   the one the merge picks anyway.
 * - `crew` goes entirely: series credits come from `created_by`, so
 *   nothing reads it.
 *
 * Everything else is passed through untouched — payloads still hold
 * whatever a later phase might want without a refetch.
 */
export function trimDetailsForCache(details: TmdbDetails): TmdbDetails {
    const aggregate = (details as TmdbTvDetails).aggregate_credits;
    if (!aggregate) {
        return details;
    }

    const cast = (aggregate.cast ?? []).map((member) => {
        const roles = member.roles ?? [];
        if (roles.length <= 1) {
            return member;
        }
        const main = roles.reduce((best, role) =>
            (role.episode_count ?? 0) > (best.episode_count ?? 0) ? role : best
        );
        return { ...member, roles: [main] };
    });

    return { ...details, aggregate_credits: { cast } } as TmdbDetails;
}
