export interface SeriesEpisodeMetadata {
    label: string;
    seasonNumber: number;
    episodeNumber: number;
    title?: string;
}

export interface SeriesPlaybackNavigation {
    canPrevious: boolean;
    canNext: boolean;
    autoplayEnabled: boolean;
}

export interface SeriesPlaybackEpisodeState<TEpisode> {
    seasonKey: string;
    seasonNumber: number;
    episodeNumber: number;
    episode: TEpisode;
    previous: TEpisode | null;
    next: TEpisode | null;
}

export function formatSeriesEpisodeLabel(
    seasonNumber: number,
    episodeNumber: number
): string {
    return `S${padSeriesNumber(seasonNumber)}E${padSeriesNumber(episodeNumber)}`;
}

function padSeriesNumber(value: number): string {
    const normalized = Number.isFinite(value) && value > 0 ? value : 0;
    return String(normalized).padStart(2, '0');
}
