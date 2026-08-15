import {
    PlaybackPositionData,
    XtreamSerieEpisode,
    XtreamSerieEpisodeInfo,
} from '@iptvnator/shared/interfaces';
import { parseDuration } from './episode-progress.util';

export interface SeasonContainerPlaybackToggleRequest {
    contentXtreamId: number;
    nextPosition: PlaybackPositionData | null;
}

export interface SeasonContainerSeasonPlaybackToggleRequest {
    seasonKey: string;
    markWatched: boolean;
    requests: SeasonContainerPlaybackToggleRequest[];
}

export function resolveEpisodeInfo(
    episode: XtreamSerieEpisode
): XtreamSerieEpisodeInfo | undefined {
    if (Array.isArray(episode.info) || !episode.info) {
        return undefined;
    }
    return episode.info;
}

/** Full-progress position row marking one episode as watched. */
export function buildWatchedEpisodePosition(options: {
    episode: XtreamSerieEpisode;
    seriesId: number;
    playlistId: string;
    fallbackSeasonKey: string | undefined;
}): PlaybackPositionData {
    const { episode } = options;
    const contentXtreamId = Number(episode.id);
    const info = resolveEpisodeInfo(episode);
    const duration = info?.duration_secs || parseDuration(info?.duration) || 1;

    return {
        contentXtreamId,
        contentType: 'episode',
        seriesXtreamId: options.seriesId,
        seasonNumber: Number(episode.season || options.fallbackSeasonKey || 1),
        episodeNumber: Number(episode.episode_num || 1),
        positionSeconds: duration,
        durationSeconds: duration,
        playlistId: options.playlistId,
        updatedAt: new Date().toISOString(),
    };
}

/** Episodes a mark-season-watched action would touch. */
export function listMarkableEpisodes(
    episodes: readonly XtreamSerieEpisode[],
    isEpisodeWatched: (episode: XtreamSerieEpisode) => boolean,
    excludedEpisodeIds?: ReadonlySet<number>
): XtreamSerieEpisode[] {
    return episodes.filter(
        (episode) =>
            !isEpisodeWatched(episode) &&
            !excludedEpisodeIds?.has(Number(episode.id))
    );
}

/**
 * Season-level bulk toggle request. Marking touches only unwatched episodes
 * so a watched episode's real duration is never overwritten with the parsed
 * fallback; unmarking clears every episode of the season. Returns null when
 * the action would touch nothing.
 *
 * `excludedEpisodeIds` (the episode playing inline or in an external
 * session, or one whose launch is in flight) is honored for MARKING only:
 * the player persists its real position every ~15 s, which would overwrite
 * a just-written full-progress row and silently flip the episode back to
 * in-progress. Unmarking still clears such an episode — the next position
 * tick recreating an in-progress row reflects the live playback truthfully.
 */
export function buildSeasonWatchToggleRequest(options: {
    episodes: readonly XtreamSerieEpisode[];
    seasonKey: string;
    seriesId: number;
    playlistId: string;
    isEpisodeWatched: (episode: XtreamSerieEpisode) => boolean;
    excludedEpisodeIds?: ReadonlySet<number>;
}): SeasonContainerSeasonPlaybackToggleRequest | null {
    const markWatched = options.episodes.some(
        (episode) => !options.isEpisodeWatched(episode)
    );
    const targets = markWatched
        ? listMarkableEpisodes(
              options.episodes,
              options.isEpisodeWatched,
              options.excludedEpisodeIds
          )
        : options.episodes;

    const requests = targets.map((episode) => ({
        contentXtreamId: Number(episode.id),
        nextPosition: markWatched
            ? buildWatchedEpisodePosition({
                  episode,
                  seriesId: options.seriesId,
                  playlistId: options.playlistId,
                  fallbackSeasonKey: options.seasonKey,
              })
            : null,
    }));
    if (requests.length === 0) {
        return null;
    }

    return { seasonKey: options.seasonKey, markWatched, requests };
}
