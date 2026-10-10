/** Whitespace-insensitive form of a synopsis for comparison. */
function normalize(text: string | null | undefined): string {
    return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * True when a season synopsis only repeats the series description shown a
 * few hundred pixels above in the hero: the same text, or one of the two
 * cut short from the other (providers often send the series plot, or its
 * first sentences, as every season's description).
 */
export function repeatsSeriesDescription(
    seasonDescription: string | null | undefined,
    seriesDescription: string | null | undefined
): boolean {
    const season = normalize(seasonDescription);
    const series = normalize(seriesDescription);
    if (!season || !series) {
        return false;
    }
    return series.startsWith(season) || season.startsWith(series);
}
