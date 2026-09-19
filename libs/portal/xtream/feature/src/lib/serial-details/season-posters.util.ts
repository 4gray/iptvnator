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
        if (isUsableUrl(url)) {
            posters[seasonKey] = url;
        }
    }
    const showPoster =
        item?.info && !Array.isArray(item.info) ? item.info.cover : undefined;
    for (const season of item?.seasons ?? []) {
        if (season?.season_number === undefined) {
            continue;
        }
        const seasonKey = String(season.season_number);
        if (posters[seasonKey]) {
            continue;
        }
        const cover = [season.cover_big, season.cover].find(
            (candidate) => isUsableUrl(candidate) && candidate !== showPoster
        );
        if (cover) {
            posters[seasonKey] = cover;
        }
    }
    return posters;
}

function isUsableUrl(value: unknown): value is string {
    return typeof value === 'string' && HTTP_URL_PATTERN.test(value.trim());
}
