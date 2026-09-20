import {
    TmdbMediaType,
    cleanTitleForSearch,
    extractYear,
    normalizeTitle,
} from '@iptvnator/shared/interfaces';
import { TmdbSearchResult } from './tmdb.types';

// Re-exported for existing consumers of the tmdb barrel
export { extractYear, normalizeTitle } from '@iptvnator/shared/interfaces';

/**
 * Title matching for TMDB search results. Provider titles are noisy
 * ("EN - The Matrix (1999) 4K"), so titles are normalized before comparison
 * and a result is only accepted when the match is high-confidence:
 * normalized title equality plus a compatible release year (±1). Without a
 * year, the normalized title must match exactly one search result.
 */

/**
 * Leading language tag without a separator ("DE Batman", "English The
 * Godfather"). Only used to build FALLBACK search variants — stripping it
 * up front would break real titles like "It Follows" or "Us". Short codes
 * must be ALL-CAPS so articles ("The", "De Lift") are left alone.
 */
const LEADING_LANGUAGE_CODE = /^\s*[A-Z]{2,3}\s+(?=\S)/;
const LEADING_LANGUAGE_WORD =
    /^\s*(?:multi|english|german|french|arabic|turkish|russian|spanish|italian|deutsch)\s+(?=\S)/i;

function stripLeadingLanguageToken(raw: string): string | null {
    if (LEADING_LANGUAGE_CODE.test(raw)) {
        return raw.replace(LEADING_LANGUAGE_CODE, '');
    }
    if (LEADING_LANGUAGE_WORD.test(raw)) {
        return raw.replace(LEADING_LANGUAGE_WORD, '');
    }
    return null;
}

/**
 * One search candidate: what to SEND to TMDB and what to COMPARE its
 * answers against. The two differ on purpose — see `cleanTitleForSearch`:
 * a folded query ("феик") finds nothing on TMDB while the folded key is
 * exactly what the confidence gate and the cache need.
 */
export interface SearchTitleVariant {
    /** Provider spelling with tags/brackets/season/year stripped */
    query: string;
    /** `normalizeTitle` of the same text; cache key and comparison form */
    normalized: string;
}

/**
 * The identity of one search on the wire: the query with only the case
 * removed, since TMDB matches case-insensitively and nothing else about
 * the spelling may be folded away — "Феик" and "Фейк" are different
 * searches with different answers, however alike their comparison keys.
 * Both the variant deduplication and the cache row use this, so a cached
 * verdict can never be read back for a search that was never sent.
 */
export function searchQueryIdentity(query: string): string {
    return query.toLowerCase();
}

/**
 * Ordered search-title candidates for one provider item: the original
 * title, the display title, then the same values with a leading
 * language-looking token dropped. The confidence gate still applies to
 * every variant, so extra candidates cannot produce wrong matches — only
 * extra searches on misses. Deduplicated by the wire identity, never by
 * the folded comparison key: two spellings that fold to one key can still
 * be different searches, and dropping the second would silently skip the
 * one TMDB actually knows.
 */
export function buildSearchTitleVariants(
    title: string | null | undefined,
    originalTitle?: string | null
): SearchTitleVariant[] {
    const variants: SearchTitleVariant[] = [];
    const push = (raw: string | null | undefined) => {
        const normalized = normalizeTitle(raw);
        const query = cleanTitleForSearch(raw);
        const identity = searchQueryIdentity(query);
        if (
            normalized &&
            query &&
            !variants.some(
                (variant) => searchQueryIdentity(variant.query) === identity
            )
        ) {
            variants.push({ query, normalized });
        }
    };

    push(originalTitle);
    push(title);
    for (const raw of [originalTitle, title]) {
        if (raw) {
            push(stripLeadingLanguageToken(raw));
        }
    }

    return variants;
}

/**
 * Cache row for one search verdict, keyed by the wire query's identity
 * (`searchQueryIdentity`), not by the folded comparison key: the verdict
 * depends on what was sent, and two spellings sharing a folded key ("Все"
 * / "Всё") may get different answers.
 */
export function buildSearchLookupKey(
    query: string,
    year: number | null
): string {
    // v2: normalizeTitleKeys learned to strip appended language/quality
    // tags; the version suffix invalidates cached (incl. negative) match
    // resolutions keyed on the old polluted titles.
    // v3: the search query stopped being the folded key ("феик" for
    // "Фейк"), which TMDB answered with nothing; every negative row recorded
    // under v2 for a title with "й"/"ё" is that bug, not a missing title, and
    // must not block the retry for its 7-day TTL. Rows are keyed by the
    // query since then.
    // v4: year evidence is tiered (see `yearEvidenceTier`), so every v3 row
    // resolved by popularity across tiers may name the wrong show — and a
    // positive row stays fresh for 30 days.
    return `title:${searchQueryIdentity(query)}|year:${year ?? ''}|v4`;
}

export function buildDetailsLookupKey(tmdbId: number): string {
    // v2: details payloads now include videos in append_to_response;
    // the version suffix invalidates pre-videos cache rows
    return `id:${tmdbId}|v2`;
}

/** Negative-cache key for a provider tmdb_id we have proven wrong */
export function buildBadProviderIdLookupKey(tmdbId: number): string {
    return `badProviderId:${tmdbId}`;
}

/** Provider tmdb_id fields arrive as number, numeric string, or garbage */
export function parseProviderTmdbId(
    tmdbId: number | string | null | undefined
): number | null {
    const parsed = Number(tmdbId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * What the payload behind a provider `tmdb_id` says about that id.
 *
 * - `corroborated`: title or release year agrees; use the details.
 * - `contradicted`: both years are known and they disagree — the classic
 *   stale id ("Blade Runner 2049" carrying the 1982 film's id). Only this
 *   verdict is strong enough to let the title search take over.
 * - `inconclusive`: the title differs and there is no year to arbitrate
 *   with. Keep the details: TMDB returns titles in the REQUEST language,
 *   and normalization strips stylized prefixes ("IT - Chapter Two"), so a
 *   name mismatch alone says more about our own inputs than about the id.
 */
export type ProviderIdVerdict =
    'corroborated' | 'contradicted' | 'inconclusive';

/** The same tolerance the search gate uses, applied in reverse */
function yearsAgree(
    providerYear: number,
    detailsYear: number,
    mediaType: TmdbMediaType
): boolean {
    if (Math.abs(detailsYear - providerYear) <= 1) {
        return true;
    }
    // Series: portals report the current season's year while TMDB reports
    // the premiere, so a show that started earlier still agrees.
    return mediaType === 'tv' && detailsYear < providerYear;
}

export function assessProviderId(
    details: {
        title?: string;
        original_title?: string;
        release_date?: string;
        name?: string;
        original_name?: string;
        first_air_date?: string;
    },
    query: {
        title?: string | null;
        originalTitle?: string | null;
        year?: number | null;
    },
    mediaType: TmdbMediaType
): ProviderIdVerdict {
    // Same effective year the search would use, so the two agree on what
    // "the provider's year" means
    const providerYear = query.year ?? extractYear(null, query.title);
    const detailsYear = extractYear(
        mediaType === 'movie' ? details.release_date : details.first_air_date
    );

    if (providerYear !== null && detailsYear !== null) {
        return yearsAgree(providerYear, detailsYear, mediaType)
            ? 'corroborated'
            : 'contradicted';
    }

    return detailsMatchProviderTitle(details, query)
        ? 'corroborated'
        : 'inconclusive';
}

/**
 * Does a details payload plausibly describe the item we asked about?
 * Title-only signal — see {@link assessProviderId} for the verdict callers
 * should act on.
 */
export function detailsMatchProviderTitle(
    details: {
        title?: string;
        original_title?: string;
        name?: string;
        original_name?: string;
    },
    query: { title?: string | null; originalTitle?: string | null }
): boolean {
    const variants = new Set(
        buildSearchTitleVariants(query.title, query.originalTitle).map(
            (variant) => variant.normalized
        )
    );
    if (variants.size === 0) {
        // Nothing to compare against — never call that a mismatch
        return true;
    }

    return [
        details.title,
        details.original_title,
        details.name,
        details.original_name,
    ].some((title) => {
        const normalized = normalizeTitle(title);
        return normalized !== '' && variants.has(normalized);
    });
}

function resultTitles(result: TmdbSearchResult, mediaType: TmdbMediaType) {
    return mediaType === 'movie'
        ? [result.title, result.original_title]
        : [result.name, result.original_name];
}

function resultYear(
    result: TmdbSearchResult,
    mediaType: TmdbMediaType
): number | null {
    return extractYear(
        mediaType === 'movie' ? result.release_date : result.first_air_date
    );
}

/**
 * How strongly one candidate's own year backs the year the provider stated.
 * Lower is stronger; `null` means the candidate is not admissible at all.
 *
 * The series tier is what makes long-running shows work: a portal reports
 * the CURRENT season's year ("The Boys s05" → 2026) while TMDB's
 * `first_air_date` is the 2019 premiere. It is a last resort, though, not an
 * equal — ranked alongside the exact-year tier with popularity deciding, it
 * hands every NEW series its older, better-known namesake. TMDB returns
 * titles in the REQUEST language, so in a non-English catalog those
 * collisions are routine rather than exotic: a 2026 local-language drama
 * (4 votes) lost to an unrelated 2018 foreign show TMDB lists under the same
 * localized name (26 votes), and rendered its poster, cast and genres. Over
 * 400 Cyrillic series titles sampled from a real catalog, 20 normalized keys
 * had a same-titled older series and 16 of those were the more popular row.
 *
 * The mirror case survives on purpose: a long-running show whose stated
 * season year happens to BE another same-titled show's premiere year now
 * resolves to the newer show. Only the older show's season air dates could
 * separate the two, and a search response does not carry them — while the
 * shape needs three coincidences at once, against one that needs none.
 */
const YEAR_TIER_EXACT = 0;
const YEAR_TIER_ADJACENT = 1;
const YEAR_TIER_EARLIER_SERIES = 2;

function yearEvidenceTier(
    year: number | null,
    wantedYear: number,
    mediaType: TmdbMediaType
): number | null {
    if (year === null) {
        return null;
    }
    if (year === wantedYear) {
        return YEAR_TIER_EXACT;
    }
    if (Math.abs(year - wantedYear) === 1) {
        return YEAR_TIER_ADJACENT;
    }

    return mediaType === 'tv' && year < wantedYear
        ? YEAR_TIER_EARLIER_SERIES
        : null;
}

/**
 * Pick the search result that confidently matches the queried title/year.
 * Returns `null` when confidence is insufficient — enrichment must never
 * attach a wrong movie's metadata.
 */
export function pickConfidentMatch(
    results: TmdbSearchResult[] | null | undefined,
    query: { title: string; year: number | null },
    mediaType: TmdbMediaType
): TmdbSearchResult | null {
    const wantedTitle = normalizeTitle(query.title);
    if (!wantedTitle || !results?.length) {
        return null;
    }

    const exactTitleMatches = results.filter((result) =>
        resultTitles(result, mediaType).some(
            (title) => normalizeTitle(title) === wantedTitle
        )
    );

    if (exactTitleMatches.length === 0) {
        return null;
    }

    const wantedYear = query.year;
    if (wantedYear !== null) {
        // Popularity only breaks ties INSIDE the strongest tier any
        // candidate reached — see `yearEvidenceTier`.
        const ranked = exactTitleMatches
            .map((result) => ({
                result,
                tier: yearEvidenceTier(
                    resultYear(result, mediaType),
                    wantedYear,
                    mediaType
                ),
            }))
            .filter(
                (
                    candidate
                ): candidate is {
                    result: TmdbSearchResult;
                    tier: number;
                } => candidate.tier !== null
            );

        if (ranked.length === 0) {
            return null;
        }

        const bestTier = Math.min(...ranked.map((candidate) => candidate.tier));
        return pickMostPopular(
            ranked
                .filter((candidate) => candidate.tier === bestTier)
                .map((candidate) => candidate.result)
        );
    }

    // Without a year the title must be unambiguous
    return exactTitleMatches.length === 1 ? exactTitleMatches[0] : null;
}

function pickMostPopular(results: TmdbSearchResult[]): TmdbSearchResult {
    return [...results].sort(
        (a, b) =>
            (b.vote_count ?? 0) - (a.vote_count ?? 0) ||
            (b.popularity ?? 0) - (a.popularity ?? 0)
    )[0];
}
