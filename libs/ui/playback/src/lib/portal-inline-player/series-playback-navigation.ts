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

export interface SeriesPlaybackEpisodeLike {
    id: string | number;
    season?: string | number;
    episode_num?: string | number;
    title?: string;
}

export interface ResolveSeriesPlaybackEpisodeStateOptions<
    TEpisode extends SeriesPlaybackEpisodeLike,
> {
    episodesBySeason: Record<string, readonly TEpisode[]> | null | undefined;
    currentEpisodeId: string | number | null | undefined;
    fallbackSeasonNumber?: number;
    fallbackEpisodeNumber?: number;
}

export function formatSeriesEpisodeLabel(
    seasonNumber: number,
    episodeNumber: number
): string {
    return `S${padSeriesNumber(seasonNumber)}E${padSeriesNumber(episodeNumber)}`;
}

export function resolveSeriesPlaybackEpisodeState<
    TEpisode extends SeriesPlaybackEpisodeLike,
>({
    episodesBySeason,
    currentEpisodeId,
    fallbackSeasonNumber,
    fallbackEpisodeNumber,
}: ResolveSeriesPlaybackEpisodeStateOptions<TEpisode>): SeriesPlaybackEpisodeState<TEpisode> | null {
    if (
        !episodesBySeason ||
        currentEpisodeId === null ||
        currentEpisodeId === undefined
    ) {
        return null;
    }

    for (const [seasonKey, episodes] of Object.entries(episodesBySeason)) {
        const episodeIndex = episodes.findIndex(
            (episode) => Number(episode.id) === Number(currentEpisodeId)
        );
        if (episodeIndex < 0) {
            continue;
        }

        const episode = episodes[episodeIndex];
        const seasonNumber =
            Number(episode.season) ||
            Number(seasonKey) ||
            fallbackSeasonNumber ||
            0;
        const episodeNumber =
            Number(episode.episode_num) ||
            fallbackEpisodeNumber ||
            episodeIndex + 1;

        return {
            seasonKey,
            seasonNumber,
            episodeNumber,
            episode,
            previous: episodes[episodeIndex - 1] ?? null,
            next: episodes[episodeIndex + 1] ?? null,
        };
    }

    return null;
}

export function getSeriesEpisodeMetadata<
    TEpisode extends SeriesPlaybackEpisodeLike,
>(
    state: SeriesPlaybackEpisodeState<TEpisode> | null
): SeriesEpisodeMetadata | null {
    if (!state) {
        return null;
    }

    return {
        label: formatSeriesEpisodeLabel(
            state.seasonNumber,
            state.episodeNumber
        ),
        seasonNumber: state.seasonNumber,
        episodeNumber: state.episodeNumber,
        title: state.episode.title,
    };
}

export function getSeriesPlaybackNavigation(
    state: SeriesPlaybackEpisodeState<unknown> | null,
    autoplayEnabled = true
): SeriesPlaybackNavigation | null {
    if (!state) {
        return null;
    }

    return {
        canPrevious: Boolean(state.previous),
        canNext: Boolean(state.next),
        autoplayEnabled,
    };
}

function padSeriesNumber(value: number): string {
    const normalized = Number.isFinite(value) && value > 0 ? value : 0;
    return String(normalized).padStart(2, '0');
}
