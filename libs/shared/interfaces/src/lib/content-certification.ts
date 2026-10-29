/** A classification stated by a metadata source, without an inferred age. */
export interface ContentCertification {
    readonly value: string;
    readonly countryCode?: string;
    readonly source: 'tmdb' | 'provider';
    readonly releaseType?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** The classifications for one country and source selected for display. */
export interface AgeRatingDisplay {
    readonly values: readonly string[];
    readonly countryCode?: string;
    readonly source: 'tmdb' | 'provider';
    readonly isCountryFallback: boolean;
    readonly hasMultipleValues: boolean;
}
