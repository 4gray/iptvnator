import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
import {
    createSeriesEpisodeDownloadSnapshot,
    type DownloadMovieSnapshotInput,
} from '@iptvnator/portal/shared/util';
import type {
    XtreamSerieEpisode,
    XtreamSerieEpisodeInfo,
} from '@iptvnator/shared/interfaces';

export interface XtreamSeriesDownloadAdapterOptions {
    readonly playlistId?: string;
    readonly seriesId: number;
    readonly title: string;
    readonly serverUrl?: string;
    readonly username?: string;
    readonly password?: string;
    readonly metadataContext: DownloadMovieSnapshotInput;
}

function isPresent(value: string | undefined): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function positiveSafeInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function episodeInfo(
    episode: XtreamSerieEpisode
): XtreamSerieEpisodeInfo | undefined {
    return Array.isArray(episode.info) ? undefined : episode.info;
}

export function createXtreamSeriesDownloadAdapter(
    options: XtreamSeriesDownloadAdapterOptions
): SeasonEpisodeDownloadAdapter {
    return {
        createCandidate(episode, fallbackSeasonKey) {
            const playlistId = options.playlistId;
            const serverUrl = options.serverUrl;
            const username = options.username;
            const password = options.password;
            const xtreamId = positiveSafeInteger(episode.id);
            const seriesXtreamId = positiveSafeInteger(options.seriesId);
            const seasonNumber = positiveSafeInteger(
                episode.season || Number(fallbackSeasonKey) || 1
            );
            const episodeNumber = positiveSafeInteger(episode.episode_num || 1);

            if (
                !isPresent(playlistId) ||
                !isPresent(serverUrl) ||
                !isPresent(username) ||
                !isPresent(password) ||
                !options.metadataContext ||
                xtreamId === null ||
                seriesXtreamId === null ||
                seasonNumber === null ||
                episodeNumber === null
            ) {
                return null;
            }

            const identity = {
                playlistId,
                contentType: 'episode' as const,
                xtreamId,
                seriesXtreamId,
                seasonNumber,
                episodeNumber,
            };

            return {
                identity,
                prepare: async () => {
                    const info = episodeInfo(episode);
                    const extension = episode.container_extension || 'mp4';
                    const normalizedServerUrl = serverUrl.replace(/\/$/, '');
                    const episodeCode = `S${String(seasonNumber).padStart(
                        2,
                        '0'
                    )}E${String(episodeNumber).padStart(2, '0')}`;

                    return {
                        ...identity,
                        title: `${options.title || 'Series'} - ${episodeCode} - ${episode.title}`,
                        url: `${normalizedServerUrl}/series/${username}/${password}/${episode.id}.${extension}`,
                        posterUrl: info?.movie_image,
                        metadataSnapshot: createSeriesEpisodeDownloadSnapshot({
                            ...options.metadataContext,
                            episode: {
                                seasonNumber,
                                episodeNumber,
                                title: episode.title,
                                plot: info?.plot,
                                stillUrl: info?.movie_image,
                            },
                        }),
                    };
                },
            };
        },
    };
}
