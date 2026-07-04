/**
 * Provider-title normalization shared by the renderer (TMDB matching,
 * catalog indexes) and the Electron DB worker (cross-playlist title
 * matching). Pure functions — no Angular/Node dependencies.
 */

const QUALITY_TAGS = new Set([
    '4k',
    'uhd',
    'fhd',
    'hd',
    'sd',
    'hdr',
    'hevc',
    'h264',
    'h265',
    'x264',
    'x265',
    '480p',
    '720p',
    '1080p',
    '2160p',
    'multi',
    'multisub',
    'vostfr',
    'vf',
    'dubbed',
]);

/**
 * Leading channel/language prefix like "EN - ", "DE| ", "FR: ".
 * UPPERCASE-only on purpose: a case-insensitive match would amputate real
 * title words ("It: Chapter Two" → "Chapter Two").
 */
const LANGUAGE_PREFIX = /^[A-Z]{2,3}\s*[-|:]\s+/;

const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;

/**
 * Release-year tag at the very end of a title ("The Matrix 1999"). Only
 * trailing years are stripped — an unanchored pattern would eat years that
 * are part of the title ("2001: A Space Odyssey" → "a space odyssey").
 */
const TRAILING_YEAR_PATTERN = /(?:^|\s)(19\d{2}|20\d{2})$/;

/**
 * Trailing season markers on series titles: "The Boys s05", "сезон 2".
 * Uses (?:^|\s) instead of \b — JS word boundaries are ASCII-only and
 * never fire next to Cyrillic letters.
 */
const SEASON_SUFFIX_PATTERN =
    /(?:^|\s)(?:s\d{1,2}|season\s*\d{1,2}|сезон\s*\d{1,2}|staffel\s*\d{1,2}|temporada\s*\d{1,2})$/i;

/**
 * A provider title normalized on two tiers. Trailing years on provider
 * titles are ambiguous — usually a release tag ("The Matrix 1999") but
 * sometimes part of the title itself ("Blade Runner 2049") — so matching
 * must try the exact form first and only fall back to the year-stripped
 * form when the stripped year does not contradict the other side's year.
 */
export interface NormalizedTitleKeys {
    /** Fully normalized, trailing year KEPT ("blade runner 2049") */
    exact: string;
    /** Trailing year stripped ("blade runner"); equals `exact` if none */
    base: string;
    /** The trailing year removed in `base`, when there was one */
    trailingYear: number | null;
}

export function normalizeTitleKeys(
    raw: string | null | undefined
): NormalizedTitleKeys {
    if (!raw) {
        return { exact: '', base: '', trailingYear: null };
    }

    const cleaned = raw
        // Inner classes exclude the opening delimiter too, so runaway
        // inputs like "[[[[[..." backtrack linearly (CodeQL js/polynomial-redos)
        .replace(/\[[^\][]*\]|\([^()]*\)|\{[^{}]*\}/g, ' ')
        .replace(LANGUAGE_PREFIX, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036F]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(' ')
        .filter((token) => token !== '' && !QUALITY_TAGS.has(token))
        .join(' ')
        .trim();

    // Portal series list titles carry season suffixes ("The Boys s05");
    // TMDB knows only the show title.
    const stripSeason = (value: string) =>
        value.replace(SEASON_SUFFIX_PATTERN, '').trim() || value;

    const exact = stripSeason(cleaned);

    // Trailing years are release tags ("The Matrix 1999"), but a year can
    // also BE the title ("2012") — never normalize down to an empty string.
    const yearMatch = cleaned.match(TRAILING_YEAR_PATTERN);
    const withoutYear = cleaned
        .replace(TRAILING_YEAR_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!yearMatch || !withoutYear) {
        return { exact, base: exact, trailingYear: null };
    }

    return {
        exact,
        base: stripSeason(withoutYear),
        trailingYear: Number(yearMatch[1]),
    };
}

export function normalizeTitle(raw: string | null | undefined): string {
    return normalizeTitleKeys(raw).base;
}

/**
 * True when a base-tier (year-stripped) title match is not contradicted by
 * the known years of both sides. Unknown years never block a match.
 */
export function titleYearsCompatible(
    a: number | null | undefined,
    b: number | null | undefined
): boolean {
    return (
        a === null ||
        a === undefined ||
        b === null ||
        b === undefined ||
        Math.abs(a - b) <= 1
    );
}

/** Extract a release year from a date string or from tags in a raw title */
export function extractYear(
    releaseDate: string | null | undefined,
    rawTitle?: string | null
): number | null {
    const fromDate = releaseDate?.match(YEAR_PATTERN)?.[0];
    if (fromDate) {
        return Number(fromDate);
    }

    const fromTitle = rawTitle?.match(YEAR_PATTERN)?.[0];
    return fromTitle ? Number(fromTitle) : null;
}
