import {
    TmdbMediaType,
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
 * Ordered search-title candidates for one provider item: the original
 * title, the display title, then the same values with a leading
 * language-looking token dropped. The confidence gate still applies to
 * every variant, so extra candidates cannot produce wrong matches — only
 * extra searches on misses.
 */
export function buildSearchTitleVariants(
    title: string | null | undefined,
    originalTitle?: string | null
): string[] {
    const variants: string[] = [];
    const push = (raw: string | null | undefined) => {
        const normalized = normalizeTitle(raw);
        if (normalized && !variants.includes(normalized)) {
            variants.push(normalized);
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

export function buildSearchLookupKey(
    normalizedTitle: string,
    year: number | null
): string {
    // v2: normalizeTitleKeys learned to strip appended language/quality
    // tags; the version suffix invalidates cached (incl. negative) match
    // resolutions keyed on the old polluted titles
    return `title:${normalizedTitle}|year:${year ?? ''}|v2`;
}

export function buildDetailsLookupKey(tmdbId: number): string {
    // v2: details payloads now include videos in append_to_response;
    // the version suffix invalidates pre-videos cache rows
    return `id:${tmdbId}|v2`;
}

/** Provider tmdb_id fields arrive as number, numeric string, or garbage */
export function parseProviderTmdbId(
    tmdbId: number | string | null | undefined
): number | null {
    const parsed = Number(tmdbId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
        const yearMatches = exactTitleMatches.filter((result) => {
            const year = resultYear(result, mediaType);
            if (year === null) {
                return false;
            }
            if (Math.abs(year - wantedYear) <= 1) {
                return true;
            }
            // Series: providers often report the CURRENT season's year
            // ("The Boys s05" → 2026) while TMDB's first_air_date is the
            // show's premiere (2019) — accept shows that started earlier.
            return mediaType === 'tv' && year < wantedYear;
        });

        if (yearMatches.length === 0) {
            return null;
        }

        return pickMostPopular(yearMatches);
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
