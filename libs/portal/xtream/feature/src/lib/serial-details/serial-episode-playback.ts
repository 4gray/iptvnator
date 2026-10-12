import type {
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    resolveSeriesPlaybackEpisodeState,
    type SeriesPlaybackEpisodeState,
} from '@iptvnator/ui/playback';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';

export interface SerialEpisodePlaybackRequest {
    readonly playlistId: string;
    readonly selectedItem: XtreamSerieDetailsView;
    readonly episode: XtreamSerieEpisode;
    readonly streamUrl: string;
    /** The episode's saved offset, when it has one. */
    readonly startTime: number | undefined;
}

export interface SerialEpisodePlayback {
    readonly playback: ResolvedPortalPlayback;
    readonly episodeState: SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null;
}

/**
 * The playback an episode of the series on screen resolves to, and its place
 * among the series' episodes for the inline player's navigation.
 */
export function buildSerialEpisodePlayback(
    request: SerialEpisodePlaybackRequest
): SerialEpisodePlayback {
    const { episode, selectedItem } = request;
    const contentInfo: PlayerContentInfo = {
        playlistId: request.playlistId,
        contentXtreamId: Number(episode.id),
        contentType: 'episode',
        seriesXtreamId: Number(selectedItem.series_id),
        seasonNumber: Number(episode.season),
        episodeNumber: Number(episode.episode_num),
    };

    const playback: ResolvedPortalPlayback = {
        streamUrl: request.streamUrl,
        title: episode.title,
        thumbnail: selectedItem.info.cover,
        startTime: request.startTime,
        contentInfo,
    };

    const episodeState = resolveSeriesPlaybackEpisodeState({
        episodesBySeason: selectedItem.episodes,
        currentEpisodeId: episode.id,
        fallbackSeasonNumber: Number(episode.season),
        fallbackEpisodeNumber: Number(episode.episode_num),
    });
    return { playback, episodeState };
}
