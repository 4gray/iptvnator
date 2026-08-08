import {
    sanitizeProviderOverview,
    XtreamSerieDetails,
} from '@iptvnator/shared/interfaces';

/**
 * Season descriptions keyed by season key: provider text from
 * `get_series_info` when it is real prose, otherwise the TMDB season
 * overview stored by the lazy season enrichment. Panels routinely put a
 * cover-image URL into `seasons[].overview`; a bare URL is junk, not a
 * description, so it is dropped instead of rendered.
 */
export function buildSeasonDescriptions(
    item: Pick<XtreamSerieDetails, 'seasons' | 'tmdb_season_overviews'> | null
): Record<string, string> {
    const descriptions: Record<string, string> = {};
    for (const season of item?.seasons ?? []) {
        const overview = sanitizeProviderOverview(season?.overview);
        if (overview && season.season_number !== undefined) {
            descriptions[String(season.season_number)] = overview;
        }
    }
    for (const [seasonKey, overview] of Object.entries(
        item?.tmdb_season_overviews ?? {}
    )) {
        if (!descriptions[seasonKey]) {
            descriptions[seasonKey] = overview;
        }
    }
    return descriptions;
}
