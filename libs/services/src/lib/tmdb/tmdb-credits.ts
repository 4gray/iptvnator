import { TmdbEnrichedCastMember } from '@iptvnator/shared/interfaces';
import { tmdbProfileUrl } from './tmdb-config';
import { TmdbCastMember, TmdbCredits, TmdbTvDetails } from './tmdb.types';

/**
 * Extraction of people from TMDB credit payloads: the display cast, the
 * clickable person chips, and the two-shape union a series cast needs.
 * Pure functions — the field-level merge itself lives in `tmdb-merge.ts`.
 */

const MAX_CAST_NAMES = 10;

/**
 * Slots held back for people who appear only in the newest season. On a
 * long-running show the whole-run cast alone fills the display limit, so
 * without a reservation the arrivals this union exists to preserve would
 * be sliced straight back off.
 */
const RESERVED_NEW_SEASON_SLOTS = 3;

const byBillingOrder = (a: { order?: number }, b: { order?: number }) =>
    (a.order ?? 0) - (b.order ?? 0);

export function limitCast(cast: TmdbCastMember[]): TmdbCastMember[] {
    return cast
        .slice(0, MAX_CAST_NAMES)
        .filter((member) => Boolean(member.name));
}

export function topCast(credits: TmdbCredits | undefined): TmdbCastMember[] {
    return limitCast([...(credits?.cast ?? [])].sort(byBillingOrder));
}

/**
 * The role an aggregate member is actually known for. A returning actor
 * accumulates one entry per character, so a single-episode cameo sits in
 * `roles[]` next to the lead they played for ten seasons — pick by episode
 * count rather than by array position.
 */
function aggregateCharacter(member: {
    roles?: { character?: string; episode_count?: number }[];
}): string | undefined {
    const named = (member.roles ?? []).filter((role) => role.character?.trim());
    if (named.length === 0) {
        return undefined;
    }
    return named.reduce((best, role) =>
        (role.episode_count ?? 0) > (best.episode_count ?? 0) ? role : best
    ).character;
}

/**
 * The cast of a SERIES, reconstructed from the two shapes TMDB offers.
 *
 * `/tv/{id}` `credits` is documented as the credits of the LATEST SEASON,
 * while `aggregate_credits` spans the whole run but — again per TMDB —
 * omits that newest season. Using either alone misreports long-running
 * shows: `credits` drops everyone who left, `aggregate_credits` drops
 * everyone who just joined. Union them.
 */
export function unifiedTvCast(details: TmdbTvDetails): TmdbCastMember[] {
    const aggregate: TmdbCastMember[] = (details.aggregate_credits?.cast ?? [])
        .filter((member) => Boolean(member.name))
        .sort(byBillingOrder)
        .map((member) => ({
            id: member.id,
            name: member.name,
            character: aggregateCharacter(member),
            order: member.order,
            profile_path: member.profile_path,
        }));

    // Cache rows written before aggregate_credits was requested, and shows
    // TMDB has no aggregate for, still work — they just keep the old cast.
    if (aggregate.length === 0) {
        return [...(details.credits?.cast ?? [])].sort(byBillingOrder);
    }

    const known = new Set(
        aggregate
            .map((member) => member.id)
            .filter((id): id is number => id !== undefined)
    );

    // Newest-season arrivals go last on purpose: their `order` is scoped to
    // that season and would otherwise outrank show-level billing.
    const arrivals = [...(details.credits?.cast ?? [])]
        .filter(
            (member) =>
                Boolean(member.name) &&
                (member.id === undefined || !known.has(member.id))
        )
        .sort(byBillingOrder);

    if (arrivals.length === 0) {
        return aggregate;
    }

    // Reserve room for the top-billed arrivals rather than appending them
    // where the cap will discard them. The reservation is a floor, not a
    // quota: whatever the aggregate leaves unused still goes to arrivals,
    // so a short whole-run cast never shrinks the list below the cap.
    const reserved = Math.min(arrivals.length, RESERVED_NEW_SEASON_SLOTS);
    const fromAggregate = aggregate.slice(
        0,
        Math.max(0, MAX_CAST_NAMES - reserved)
    );
    return [
        ...fromAggregate,
        ...arrivals.slice(0, MAX_CAST_NAMES - fromAggregate.length),
    ];
}

export function castNames(cast: TmdbCastMember[]): string {
    return cast.map((member) => member.name).join(', ');
}

/** Cast with profile photos for the avatar chips in detail views */
export function enrichedCast(cast: TmdbCastMember[]): TmdbEnrichedCastMember[] {
    return cast.map((member) => ({
        name: member.name,
        ...(member.character ? { character: member.character } : {}),
        profileUrl: tmdbProfileUrl(member.profile_path),
        ...(member.id ? { tmdbPersonId: member.id } : {}),
    }));
}

export function directorNames(credits: TmdbCredits | undefined): string {
    return (credits?.crew ?? [])
        .filter((member) => member.job === 'Director')
        .map((member) => member.name)
        .filter(Boolean)
        .join(', ');
}

export function creatorNames(details: TmdbTvDetails): string {
    return (details.created_by ?? [])
        .map((creator) => creator.name)
        .filter(Boolean)
        .join(', ');
}

/**
 * Directors (movies) as clickable person chips — same shape as the cast
 * chips, so a director opens the same person page as an actor. Deduped by
 * TMDB id to collapse the duplicate crew rows TMDB sometimes returns.
 */
export function enrichedDirectors(
    credits: TmdbCredits | undefined
): TmdbEnrichedCastMember[] {
    const seen = new Set<number>();
    const directors: TmdbEnrichedCastMember[] = [];
    for (const member of credits?.crew ?? []) {
        if (member.job !== 'Director' || !member.name) {
            continue;
        }
        if (member.id !== undefined) {
            if (seen.has(member.id)) {
                continue;
            }
            seen.add(member.id);
        }
        directors.push({
            name: member.name,
            profileUrl: tmdbProfileUrl(member.profile_path),
            ...(member.id ? { tmdbPersonId: member.id } : {}),
        });
    }
    return directors;
}

/** Series creators as clickable person chips (TV shows have no director) */
export function enrichedCreators(details: TmdbTvDetails): TmdbEnrichedCastMember[] {
    return (details.created_by ?? [])
        .filter((creator) => Boolean(creator.name))
        .map((creator) => ({
            name: creator.name,
            profileUrl: tmdbProfileUrl(creator.profile_path),
            ...(creator.id ? { tmdbPersonId: creator.id } : {}),
        }));
}
