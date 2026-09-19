import { XtreamSerieDetails } from '@iptvnator/shared/interfaces';

const HTTP_URL_PATTERN = /^https?:\/\//i;

type SeasonPosterSource = Pick<
    XtreamSerieDetails,
    'seasons' | 'tmdb_season_posters'
> & {
    /** Provider `info` is `[]` on some panels when no metadata exists */
    info?: { cover?: string } | [];
};

/**
 * Season posters keyed by season key, TMDB-first like the show artwork
 * merge (`prefer(tmdbPoster, provider)` in `tmdb-merge.ts`): the season's
 * own TMDB poster stored by the lazy season enrichment wins, and the
 * provider's `seasons[].cover_big`/`cover` from `get_series_info` fills
 * the gap. A provider season cover is accepted only as an http(s) URL
 * that differs from the show poster — panels routinely repeat the show
 * poster on every season, and a duplicate would render the hero poster a
 * second time under the season tabs.
 */
export function buildSeasonPosters(
    item: SeasonPosterSource | null
): Record<string, string> {
    const posters: Record<string, string> = {};
    for (const [seasonKey, url] of Object.entries(
        item?.tmdb_season_posters ?? {}
    )) {
        const usable = usableUrl(url);
        if (usable) {
            posters[seasonKey] = usable;
        }
    }
    const showPoster =
        item?.info && !Array.isArray(item.info)
            ? usableUrl(item.info.cover)
            : null;
    for (const season of item?.seasons ?? []) {
        if (season?.season_number === undefined) {
            continue;
        }
        const seasonKey = String(season.season_number);
        if (posters[seasonKey]) {
            continue;
        }
        // Panels pad URLs with whitespace now and then; compare and store
        // the trimmed form so a padded copy of the show poster is still
        // recognized as the duplicate it is.
        const cover = [season.cover_big, season.cover]
            .map(usableUrl)
            .find(
                (candidate) => candidate !== null && candidate !== showPoster
            );
        if (cover) {
            posters[seasonKey] = cover;
        }
    }
    return posters;
}

/** The trimmed http(s) URL, or null for anything else. */
function usableUrl(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return HTTP_URL_PATTERN.test(trimmed) ? trimmed : null;
}
