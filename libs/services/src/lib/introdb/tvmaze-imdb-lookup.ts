import {
    cleanTitleForSearch,
    extractYear,
    normalizeTitle,
    releaseTagYear,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';

/**
 * Series title → IMDb id through TVmaze, for series TMDB enrichment did not
 * match (it is opt-in, and many users never enable it). TVmaze needs no key
 * and allows any origin, so both the Electron renderer and the PWA can ask.
 */
export const TVMAZE_SEARCH_URL = 'https://api.tvmaze.com/search/shows';

const IMDB_ID_PATTERN = /^tt\d{7,10}$/;

interface TvMazeSearchEntry {
    show?: {
        name?: unknown;
        premiered?: unknown;
        externals?: { imdb?: unknown } | null;
    } | null;
}

/**
 * The IMDb id of the best-ranked result whose name is the provider title
 * and whose premiere year does not contradict a year the title states.
 * TVmaze ranks its results; anything that is not the same title is a guess,
 * and a wrong guess would put a stranger's intro on this episode.
 */
export function pickTvMazeImdbId(
    results: unknown,
    rawTitle: string
): string | null {
    const wanted = normalizeTitle(rawTitle);
    if (!wanted || !Array.isArray(results)) {
        return null;
    }
    const year = releaseTagYear(rawTitle);
    for (const entry of results as TvMazeSearchEntry[]) {
        const show = entry?.show;
        const imdb = show?.externals?.imdb;
        if (
            typeof imdb === 'string' &&
            IMDB_ID_PATTERN.test(imdb) &&
            typeof show?.name === 'string' &&
            normalizeTitle(show.name) === wanted &&
            titleYearsCompatible(
                year,
                extractYear(
                    typeof show.premiered === 'string' ? show.premiered : null
                )
            )
        ) {
            return imdb;
        }
    }
    return null;
}

/** Null when the title is empty, TVmaze is unreachable or nothing matches. */
export async function searchTvMazeImdbId(
    rawTitle: string,
    fetchFn: typeof fetch = fetch
): Promise<string | null> {
    const query = cleanTitleForSearch(rawTitle);
    if (!query) {
        return null;
    }
    const url = new URL(TVMAZE_SEARCH_URL);
    url.searchParams.set('q', query);
    try {
        const response = await fetchFn(url.toString(), {
            headers: { accept: 'application/json' },
        });
        return response.ok
            ? pickTvMazeImdbId(await response.json(), rawTitle)
            : null;
    } catch {
        return null;
    }
}
