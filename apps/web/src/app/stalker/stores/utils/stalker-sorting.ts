import {
    StalkerSeason,
    StalkerVodSeriesEpisode,
    StalkerVodSeriesSeason,
} from '../../models';

export function extractNumericValue(str: string): number {
    const matches = str.match(/\d+/);
    if (matches) {
        return parseInt(matches[0], 10);
    }
    return 0;
}

export function sortByNumericValue(array: StalkerSeason[]): StalkerSeason[] {
    if (!array) return [];
    const key = 'name';
    return [...array].sort((a, b) => {
        const numericA = extractNumericValue(a[key]);
        const numericB = extractNumericValue(b[key]);
        return numericA - numericB;
    });
}

export function sortVodSeriesSeasonsByNumber(
    array: StalkerVodSeriesSeason[]
): StalkerVodSeriesSeason[] {
    if (!array) return [];
    return [...array].sort((a, b) => {
        const numA = Number(a.season_number ?? 0) || 0;
        const numB = Number(b.season_number ?? 0) || 0;
        return numA - numB;
    });
}

/**
 * Sort episodes by series_number in ascending numeric order (1, 2, 3... not "1", "10", "2")
 */
export function sortEpisodesByNumber(
    episodes: StalkerVodSeriesEpisode[]
): StalkerVodSeriesEpisode[] {
    if (!episodes) return [];
    return [...episodes].sort((a, b) => {
        const numA = Number(a.series_number ?? 0) || 0;
        const numB = Number(b.series_number ?? 0) || 0;
        return numA - numB;
    });
}
