import { extractYear, tmdbPosterUrl } from '@iptvnator/services';
import type { TmdbSearchResult } from '@iptvnator/services';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';
import {
    DashboardTmdbLookupItem,
    dashboardTmdbLookupKey,
} from './dashboard-tmdb-lookup.util';

/** One recommendation card: TMDB entry + the library match that makes it playable */
export interface DashboardRecommendationItem {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    /**
     * TMDB original title when it differs from the localized one — a
     * matching/exclusion alias, never displayed. Catalogs frequently name
     * an item in its original language while the app language localizes
     * the TMDB title, so matching on the localized form alone would hide
     * available recommendations.
     */
    originalTitle: string | null;
    year: number | null;
    posterUrl: string | null;
    /** vote_average rounded to one decimal, null without votes */
    rating: string | null;
    /** Confident match in an imported Xtream playlist — unmatched entries are dropped */
    match: CatalogTitleMatch;
    /** Display title of the watched item this recommendation came from */
    seedTitle: string;
}

export type RecommendationCandidate = Omit<DashboardRecommendationItem, 'match'>;

/**
 * The release year an activity row STATES in a metadata field, never one
 * parsed out of its title.
 *
 * The exact tier compares whole normalized titles, so a trailing number
 * there belongs to the NAME: "Blade Runner 2049" is not a 2049 film, and
 * gating that key on a title-derived 2049 would fail to exclude the very
 * film the user just watched (TMDB calls it 2017). Only Stalker rows
 * carry a real date (`info.releasedate`); everything else yields `null`,
 * which keeps the exact tier excluding unconditionally.
 *
 * The base tier is different by construction — its key exists only
 * because a trailing year was stripped off — so it keeps using that year.
 */
export function trustedReleaseYear(
    item: DashboardTmdbLookupItem
): number | null {
    const info = (
        item.stalker_item as { info?: Record<string, unknown> } | undefined
    )?.info;
    const releaseDate = info?.['releasedate'];
    return typeof releaseDate === 'string' ? extractYear(releaseDate) : null;
}

/**
 * What the user has already watched or favorited, in the two forms a
 * recommendation can collide with.
 */
export interface ExclusionIndex {
    /**
     * `type:exactNormalizedTitle` → the release years of the rows that
     * produced it. `null` means the row stated no year, which keeps the
     * conservative "exclude anyway" behaviour for that entry.
     */
    readonly exact: ReadonlyMap<string, readonly (number | null)[]>;
    /**
     * `type:baseNormalizedTitle` → the trailing years stripped from the
     * stored titles that produced it. Only titles that HAD a trailing
     * year appear here, so the base tier is always year-gated.
     */
    readonly baseYears: ReadonlyMap<string, readonly number[]>;
}

/** Normalized keys for one candidate alias, both matching tiers */
interface CandidateKeys {
    readonly exact: string;
    readonly base: string;
}

/**
 * Both matching tiers for each of the candidate's aliases — localized
 * title first, original-title alias second.
 */
function candidateKeySets(
    candidate: RecommendationCandidate
): CandidateKeys[] {
    const type = candidate.mediaType === 'movie' ? 'movie' : 'series';
    const toKeys = (title: string): CandidateKeys => {
        const keys = normalizeTitleKeys(title);
        return { exact: `${type}:${keys.exact}`, base: `${type}:${keys.base}` };
    };

    const sets = [toKeys(candidate.title)];
    if (candidate.originalTitle) {
        const alias = toKeys(candidate.originalTitle);
        if (alias.exact !== sets[0].exact) {
            sets.push(alias);
        }
    }
    return sets;
}

/** Exact-tier keys only — used for dedupe and catalog-match lookup */
function candidateTitleKeys(candidate: RecommendationCandidate): string[] {
    return candidateKeySets(candidate).map((keys) => keys.exact);
}

/**
 * EVERY match per `type:exactNormalizedTitle`, in the order the worker
 * returned them.
 *
 * Deliberately not the shared `buildTitleMatchIndex`: that collapses to
 * one row per key before the candidate's year is known, so a catalog
 * holding both "Dune 1984" and "Dune 2021" keeps whichever arrived first
 * and a 2021 recommendation then fails the year check with the right row
 * already discarded. Keeping every row lets the year gate choose.
 */
export function groupMatchesByKey(
    matches: readonly CatalogTitleMatch[]
): Map<string, CatalogTitleMatch[]> {
    const grouped = new Map<string, CatalogTitleMatch[]>();
    for (const match of matches) {
        const key = `${match.type}:${normalizeTitleKeys(match.queryTitle).exact}`;
        grouped.set(key, [...(grouped.get(key) ?? []), match]);
    }
    return grouped;
}

/**
 * The catalog row this recommendation should link to, or null.
 *
 * Aliases are tried in order (localized title, then original-title), and
 * within one alias only year-compatible rows qualify — a localized title
 * can hit a same-named different-year row while the alias holds the
 * correct match, so a bad hit must not veto the good one. Among equally
 * compatible rows an exact-title match wins over a year-stripped one,
 * mirroring `buildTitleMatchIndex`'s own precedence.
 */
export function pickCatalogMatch(
    candidate: RecommendationCandidate,
    grouped: ReadonlyMap<string, CatalogTitleMatch[]>
): CatalogTitleMatch | null {
    for (const key of candidateTitleKeys(candidate)) {
        const compatible = (grouped.get(key) ?? []).filter((row) =>
            titleYearsCompatible(candidate.year, row.trailingYear)
        );
        if (compatible.length === 0) {
            continue;
        }
        return (
            compatible.find((row) => row.trailingYear === null) ??
            compatible[0]
        );
    }
    return null;
}

/**
 * Whether the user has already watched or favorited this recommendation.
 *
 * Two tiers, because a provider stores whatever the panel named the file.
 * The exact tier catches a stored title that normalizes to the canonical
 * one. The base tier catches the common `"Inception 2010"` shape, whose
 * exact key can never equal TMDB's `"Inception"` — but only when the
 * years agree, so a stored `"Blade Runner 2049"` does not swallow the
 * 1982 film. An unknown year on either side counts as agreeing
 * (`titleYearsCompatible`): recommending something already watched is the
 * worse failure of the two.
 */
export function isExcludedCandidate(
    candidate: RecommendationCandidate,
    excluded: ExclusionIndex
): boolean {
    const yearAgrees = (year: number | null): boolean =>
        year === null || titleYearsCompatible(candidate.year, year);

    return candidateKeySets(candidate).some(
        ({ exact, base }) =>
            (excluded.exact.get(exact) ?? []).some(yearAgrees) ||
            (excluded.baseYears.get(base) ?? []).some((year) =>
                titleYearsCompatible(candidate.year, year)
            )
    );
}

/**
 * Identity of one load: the seed set, the watched/favorited exclusion
 * index, and the imported-playlist set. Including the exclusions means
 * favoriting a recommended title (or new watch history that does not
 * change the top seeds) still invalidates the latch and re-filters the
 * rail; including the catalog means imports and deletions re-run the
 * matching.
 */
export function buildLoadKey(
    seeds: readonly DashboardTmdbLookupItem[],
    excluded: ExclusionIndex,
    catalogKey: string
): string {
    const serializeYears = (
        entries: ReadonlyMap<string, readonly (number | null)[]>
    ): string[] =>
        [...entries]
            .map(
                ([key, years]) =>
                    `${key}=${[...years]
                        .map((year) => year ?? '?')
                        .sort()
                        .join('/')}`
            )
            .sort();

    const exclusionKey = [
        ...serializeYears(excluded.exact),
        ...serializeYears(excluded.baseYears),
    ].join('|');
    return `${catalogKey}@@${seeds
        .map(dashboardTmdbLookupKey)
        .join('||')}##${exclusionKey}`;
}

export function toCandidates(
    results: readonly TmdbSearchResult[],
    mediaType: 'movie' | 'tv',
    seedTitle: string
): RecommendationCandidate[] {
    return results
        .map((result) => {
            const title = result.title ?? result.name ?? '';
            const original =
                result.original_title ?? result.original_name ?? '';
            const rating =
                (result.vote_count ?? 0) > 0 && result.vote_average
                    ? result.vote_average.toFixed(1)
                    : null;
            return {
                tmdbId: result.id,
                mediaType,
                title,
                originalTitle:
                    original !== '' && original !== title ? original : null,
                year: extractYear(result.release_date ?? result.first_air_date),
                posterUrl: tmdbPosterUrl(result.poster_path),
                rating,
                seedTitle,
            };
        })
        .filter((entry) => entry.tmdbId > 0 && entry.title !== '');
}
