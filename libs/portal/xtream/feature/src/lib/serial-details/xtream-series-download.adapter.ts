import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
import {
    createSeriesEpisodeDownloadSnapshot,
    type DownloadMovieSnapshotInput,
} from '@iptvnator/portal/shared/util';
import {
    normalizeXtreamServerUrl,
    XTREAM_CLIENT_USER_AGENT,
    type XtreamSerieEpisode,
    type XtreamSerieEpisodeInfo,
} from '@iptvnator/shared/interfaces';

export interface XtreamSeriesDownloadAdapterOptions {
    readonly playlistId?: string;
    readonly seriesId: number;
    readonly title: string;
    readonly serverUrl?: string;
    readonly username?: string;
    readonly password?: string;
    readonly userAgent?: string;
    readonly referrer?: string;
    readonly origin?: string;
    readonly metadataContext: DownloadMovieSnapshotInput;
}

function isPresent(value: string | undefined): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function positiveSafeInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function downloadSeasonNumber(
    value: unknown,
    fallbackSeasonKey: string | undefined
): number | null {
    const isMissing =
        value == null ||
        (typeof value === 'string' && value.trim() === '') ||
        (typeof value === 'number' && Number.isNaN(value));
    if (!isMissing) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    const normalizedFallback = fallbackSeasonKey?.trim();
    const fallback = Number(normalizedFallback || 1);
    return Number.isSafeInteger(fallback) && fallback >= 0 ? fallback : null;
}

/**
 * The episode URL exactly as playback builds it
 * (`XtreamUrlService.constructEpisodeUrl`): normalized server URL and
 * percent-encoded credentials, so a password holding `#`, `?`, `/` or `%`
 * downloads the same stream it plays. Null when the server URL is unusable.
 */
function episodeDownloadUrl(
    serverUrl: string,
    username: string,
    password: string,
    episodeId: string,
    extension: string
): string | null {
    let server: string;
    try {
        server = normalizeXtreamServerUrl(serverUrl);
    } catch {
        return null;
    }
    return `${server}/series/${encodeURIComponent(username.trim())}/${encodeURIComponent(password.trim())}/${episodeId}.${extension}`;
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
            const seasonNumber = downloadSeasonNumber(
                episode.season,
                fallbackSeasonKey
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
                    const url = episodeDownloadUrl(
                        serverUrl,
                        username,
                        password,
                        episode.id,
                        extension
                    );
                    if (!url) {
                        throw new Error('Invalid Xtream server URL');
                    }
                    const episodeCode = `S${String(seasonNumber).padStart(
                        2,
                        '0'
                    )}E${String(episodeNumber).padStart(2, '0')}`;

                    return {
                        ...identity,
                        title: `${options.title || 'Series'} - ${episodeCode} - ${episode.title}`,
                        url,
                        posterUrl: info?.movie_image,
                        headers: {
                            userAgent:
                                options.userAgent?.trim() ||
                                XTREAM_CLIENT_USER_AGENT,
                            referer: options.referrer,
                            origin: options.origin,
                        },
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
