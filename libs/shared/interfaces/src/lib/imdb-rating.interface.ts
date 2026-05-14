export interface ImdbMovieRatingRequestItem {
    id: string | number;
    imdbId?: string;
    kind?: 'movie' | 'series';
    title?: string;
    originalTitle?: string;
    year?: string | number;
    durationMinutes?: string | number;
}

export interface ImdbMovieRatingMatch {
    id: string | number;
    imdbId: string;
    rating: number;
    votes: number;
    title: string;
    year?: number;
    runtimeMinutes?: number;
    confidence: number;
    matchReason: string;
}

export interface ImdbMovieRatingsResponse {
    status: 'ready' | 'error';
    matches: Record<string, ImdbMovieRatingMatch>;
    cacheUpdatedAt?: string;
    error?: string;
}
