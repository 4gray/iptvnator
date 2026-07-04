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

/** Leading channel/language prefix like "EN - ", "DE| ", "FR: " */
const LANGUAGE_PREFIX = /^[a-z]{2,3}\s*[-|:]\s+/i;

const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;

/**
 * Trailing season markers on series titles: "The Boys s05", "сезон 2".
 * Uses (?:^|\s) instead of \b — JS word boundaries are ASCII-only and
 * never fire next to Cyrillic letters.
 */
const SEASON_SUFFIX_PATTERN =
    /(?:^|\s)(?:s\d{1,2}|season\s*\d{1,2}|сезон\s*\d{1,2}|staffel\s*\d{1,2}|temporada\s*\d{1,2})$/i;

export function normalizeTitle(raw: string | null | undefined): string {
    if (!raw) {
        return '';
    }

    const cleaned = raw
        .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
        .replace(LANGUAGE_PREFIX, '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(' ')
        .filter((token) => token !== '' && !QUALITY_TAGS.has(token))
        .join(' ');

    // Trailing years are release tags ("The Matrix 1999"), but a year can
    // also BE the title ("2012") — never normalize down to an empty string.
    let result = cleaned.trim();
    const withoutYear = result
        .replace(YEAR_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (withoutYear) {
        result = withoutYear;
    }

    // Portal series list titles carry season suffixes ("The Boys s05");
    // TMDB knows only the show title.
    const withoutSeason = result.replace(SEASON_SUFFIX_PATTERN, '').trim();
    return withoutSeason || result;
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
