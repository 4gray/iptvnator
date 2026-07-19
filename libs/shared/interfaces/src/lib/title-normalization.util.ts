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
 * Wrapped tag at the very start of a provider title: "|DE| ARD",
 * "|MULTI| Fallout". The lookahead requires a letter in the tag so a
 * numeric fragment can never be treated as one.
 */
const WRAPPED_TAG_PREFIX = /^\s*\|(?=[0-9+]*[A-Z])[A-Z0-9+]{2,5}\|\s*/;

/**
 * Leading channel/language prefix like "EN - ", "DE| ", "FR: ", including
 * compound provider/quality forms ("4K-DE - ", "AR-SUBS - ", "4K-OSN+ - ")
 * and longer tags ("EXYU| ", "MULTI| ").
 * UPPERCASE-only on purpose: a case-insensitive match would amputate real
 * title words ("It: Chapter Two" → "Chapter Two"). Every segment must
 * contain a letter so numeric titles ("1917 - ...") are never tags.
 * Colon separators stay limited to 2–3 chars — longer acronyms before a
 * colon are franchise titles ("NCIS: LA"), not tags.
 */
const LANGUAGE_PREFIX =
    /^(?:(?=[0-9+]*[A-Z])[A-Z0-9+]{2,5}(?:-(?=[0-9+]*[A-Z])[A-Z0-9+]{2,6}){0,2}\s*[-|]\s+|(?=[0-9+]*[A-Z])[A-Z0-9+]{2,3}\s*:\s+)/;

/**
 * Curated whitelist for TRAILING language/subtitle tags ("Fallout_eng",
 * "Breaking Bad-DE", "The Pitt (2025) ES"). Trailing stripping must be
 * vocabulary-gated: a pattern-only rule would amputate real endings —
 * roman numerals ("Rocky II"), acronyms ("Made in USA"), franchise
 * suffixes ("NCIS: LA"). US/USA/UK/LA are deliberately absent.
 */
const TRAILING_TAG_VOCABULARY = new Set([
    'AF', 'AL', 'ALB', 'AR', 'BY', 'DE', 'DUB', 'EN', 'ENG', 'ES', 'ESP',
    'EXYU', 'FR', 'FRA', 'GE', 'GR', 'HU', 'IN', 'IR', 'IS', 'IT', 'ITA',
    'KA', 'KU', 'LAT', 'ML', 'MSUB', 'MULTI', 'NL', 'PL', 'PT', 'RO', 'RU',
    'SC', 'SE', 'SUB', 'SUBS', 'SW', 'TA', 'TL', 'TR', 'TUR',
]);

const DOUBLE_DASH_SUFFIX = /[-–]{2}[A-Za-z]{2,5}\s*$/;
const UNDERSCORE_SUFFIX = /_[A-Za-z]{2,5}\s*$/;
const JOINED_DASH_SUFFIX = /-([A-Za-z]{2,5})\s*$/;
const TRAILING_TAG_SUFFIX = /\s([A-Z]{2,5})\s*$/;

/** Tag tokens are case-uniform; real title words are Capitalized. */
function isCaseUniform(token: string): boolean {
    return token === token.toLowerCase() || token === token.toUpperCase();
}

/** ES2015-safe trailing-whitespace trim (the lib target predates trimEnd). */
function trimRight(value: string): string {
    return value.replace(/\s+$/, '');
}

/**
 * Strip appended language/subtitle tags. Runs BEFORE lowercasing —
 * casing is the main false-positive guard: ALL-CAPS titles carry no
 * casing signal ("THE LAST OF US" must keep its "US"), so caps-gated
 * rules are skipped for them, and Capitalized endings ("Making It",
 * "Kick-It") never look like tags. Compound tags ("FR-EN") shed one
 * token per pass, so stripping repeats to a fixpoint.
 */
function stripTrailingTags(value: string): string {
    let result = value;
    for (let pass = 0; pass < 3; pass++) {
        const next = stripTrailingTagOnce(result);
        if (next === result) break;
        result = next;
    }
    return result;
}

function stripTrailingTagOnce(value: string): string {
    const result = trimRight(value);
    const hasLowercase = /\p{Ll}/u.test(result);

    // "The Last of Us--esp": no real title contains a double dash.
    if (DOUBLE_DASH_SUFFIX.test(result)) {
        return trimRight(result.replace(DOUBLE_DASH_SUFFIX, ''));
    }

    // "Fallout_eng" — but not "The_Last_of_Us", where underscores are
    // space substitutes (only strip when this is the sole underscore).
    if (
        UNDERSCORE_SUFFIX.test(result) &&
        result.indexOf('_') === result.lastIndexOf('_')
    ) {
        return trimRight(result.replace(UNDERSCORE_SUFFIX, ''));
    }

    const joined = result.match(JOINED_DASH_SUFFIX);
    if (
        joined &&
        TRAILING_TAG_VOCABULARY.has(joined[1].toUpperCase()) &&
        isCaseUniform(joined[1]) &&
        (joined[1] !== joined[1].toUpperCase() || hasLowercase)
    ) {
        return trimRight(result.replace(JOINED_DASH_SUFFIX, ''));
    }

    const trailing = result.match(TRAILING_TAG_SUFFIX);
    if (trailing && hasLowercase && TRAILING_TAG_VOCABULARY.has(trailing[1])) {
        return trimRight(result.replace(TRAILING_TAG_SUFFIX, ''));
    }

    return result;
}

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

    const cleaned = stripTrailingTags(
        raw
            .replace(WRAPPED_TAG_PREFIX, '')
            // Inner classes exclude the opening delimiter too, so runaway
            // inputs like "[[[[[..." backtrack linearly (CodeQL js/polynomial-redos)
            .replace(/\[[^\][]*\]|\([^()]*\)|\{[^{}]*\}/g, ' ')
            .replace(LANGUAGE_PREFIX, '')
    )
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
