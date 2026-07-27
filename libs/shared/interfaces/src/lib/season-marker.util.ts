/**
 * Season markers in provider titles. Providers often slice a show into
 * per-season catalog items ("The Mandalorian (2 season)", "Пацаны 2 сезон",
 * "The Boys S05") and renumber the single contained season to 1 — the
 * marker in the title is then the only source of the real season number.
 * Pure functions shared by the renderer and tests — no Angular/Node deps.
 */

/**
 * Season vocabulary shared with the trailing-suffix stripper in
 * `title-normalization.util.ts`. Words only — digit placement (before or
 * after the word) is handled by the patterns built from it.
 */
export const SEASON_WORD_ALTERNATIVES = 'season|сезон|staffel|temporada|saison';

const SEASON_WORD = `(?:${SEASON_WORD_ALTERNATIVES})`;

/**
 * "Season 2", "season_02", "season2", "сезон 2". The leading guard blocks
 * word-internal matches ("postseason 3"); the digit lookahead rejects
 * 3+-digit numbers, which are never season markers.
 */
const WORD_FIRST_MARKER = new RegExp(
    `(?:^|[^\\p{L}])${SEASON_WORD}[\\s_.-]*(\\d{1,2})(?!\\d)`,
    'iu'
);

/**
 * "2 season", "2nd Season", "2 сезон", "2-й сезон". The digit guard keeps
 * long numbers out ("2001 season" never yields season 20/01), the trailing
 * lookahead rejects plurals ("The Four Seasons", "2 Seasons").
 */
const NUMBER_FIRST_MARKER = new RegExp(
    `(?:^|[^\\d])(\\d{1,2})\\s*(?:st|nd|rd|th|-?й|-?я|-?ой)?[\\s_.-]+${SEASON_WORD}(?!\\p{L})`,
    'iu'
);

/**
 * "S02", "s2" — and the season half of "S02E05". Tightly bounded on both
 * sides so words ending in "s" followed by a number ("Ocean's 11",
 * "Cars 2") can never match.
 */
const S_FORM_MARKER = /(?:^|[\s([{_.-])s(\d{1,2})(?=$|[\s)\]}_.-]|e\d)/i;

/**
 * Extract an explicit season number from a RAW provider title (before any
 * normalization — bracket groups like "(2 season)" are removed by
 * `normalizeTitleKeys`, so this must see the original string). Returns
 * `null` when there is no unambiguous marker; season 0 ("specials") is
 * deliberately rejected.
 */
export function extractSeasonFromTitle(
    raw: string | null | undefined
): number | null {
    if (!raw) {
        return null;
    }

    for (const pattern of [
        WORD_FIRST_MARKER,
        NUMBER_FIRST_MARKER,
        S_FORM_MARKER,
    ]) {
        const match = raw.match(pattern);
        if (match) {
            const season = Number(match[1]);
            if (season >= 1) {
                return season;
            }
        }
    }

    return null;
}

/**
 * The first candidate title carrying an explicit season marker, else the
 * first non-empty one. Providers spread the descriptive title across
 * fields (a generic `name` with the marker only in `o_name`), and the
 * marker must be read from whichever field carries it.
 */
export function pickSeasonMarkedTitle(
    ...titles: readonly (string | null | undefined)[]
): string | null {
    for (const title of titles) {
        if (extractSeasonFromTitle(title) !== null) {
            return title ?? null;
        }
    }
    return titles.find((title) => !!title) ?? null;
}

export interface SeasonNumberResolution {
    /** RAW provider title of the series item (not normalized) */
    rawTitle: string | null | undefined;
    /** Season number reported by the provider's episode data */
    providerSeasonNumber: number;
    /** How many seasons the provider item contains in total */
    providerSeasonCount: number;
}

/**
 * The TMDB season number to fetch for a provider season. Provider data
 * stays authoritative except for the one case it is known to lie about:
 * a SINGLE-season item whose title carries a different explicit season
 * marker is a per-season slice with renumbered seasons — the marker names
 * the real TMDB season. Multi-season items always keep provider numbering
 * (overriding all their seasons from one title marker would be wrong).
 */
export function resolveEnrichmentSeasonNumber(
    resolution: SeasonNumberResolution
): number {
    const fromTitle = extractSeasonFromTitle(resolution.rawTitle);
    if (
        fromTitle !== null &&
        resolution.providerSeasonCount === 1 &&
        fromTitle !== resolution.providerSeasonNumber
    ) {
        return fromTitle;
    }
    return resolution.providerSeasonNumber;
}
