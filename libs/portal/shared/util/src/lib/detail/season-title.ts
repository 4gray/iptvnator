export interface SeasonTitleParts {
    /** The provider title without its season marker. */
    readonly title: string;
    readonly season: number | null;
}

// "(1 сезон)", "Сезон 2", "Season 3", "S04", "- Season 2", "[Season 2]".
// The marker must close the title: a leading season word stays part of it.
const SEASON_SUFFIX =
    /[\s\-–—:·|,]*[([]?\s*(?:(\d{1,2})\s*(?:-?й\s*)?сезон|сезон\s*(\d{1,2})|season\s*(\d{1,2})|temporada\s*(\d{1,2})|staffel\s*(\d{1,2})|saison\s*(\d{1,2})|S(\d{2}))\s*[)\]]?\s*$/i;

/**
 * Strips a trailing season marker from a provider series title so the hero
 * shows "Большая фарма" with a "Season 1" chip instead of "Большая фарма
 * (1 сезон)". Titles without a marker are returned unchanged.
 */
export function splitSeasonSuffix(rawTitle: string | null | undefined): SeasonTitleParts {
    const title = (rawTitle ?? '').trim();
    const match = title.match(SEASON_SUFFIX);
    if (!match || match.index === undefined || match.index === 0) {
        return { title, season: null };
    }
    const season = Number(match.slice(1).find((group) => group !== undefined));
    const stripped = title.slice(0, match.index).trim();
    if (!stripped || !Number.isInteger(season) || season <= 0) {
        return { title, season: null };
    }
    return { title: stripped, season };
}
