import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';

/**
 * Pure helpers for mapping episodes (Xtream and Stalker-mapped) to the
 * download-manager content ids and download requests used by the season
 * container.
 */

export interface XtreamEpisodeDownloadContext {
    serverUrl?: string;
    username?: string;
    password?: string;
}

export interface XtreamEpisodeDownloadRequest {
    playlistId: string;
    xtreamId: number;
    contentType: 'episode';
    title: string;
    url: string;
    posterUrl?: string;
    seriesXtreamId: number;
    seasonNumber: number;
    episodeNumber: number;
}

export function hashString(str: string): number {
    let hash = 0;
    for (let index = 0; index < str.length; index++) {
        const char = str.charCodeAt(index);
        hash = (hash << 5) - hash + char;
        hash &= hash;
    }
    return Math.abs(hash);
}

export function isStalkerEpisode(episode: XtreamSerieEpisode): boolean {
    const customSid = (episode as { custom_sid?: string }).custom_sid;
    return customSid === 'vod-series' || customSid === 'regular-series';
}

export function getEpisodeDownloadId(episode: XtreamSerieEpisode): number {
    const customSid = (episode as { custom_sid?: string }).custom_sid;

    if (customSid === 'regular-series') {
        const cmd = (episode as { originalCmd?: string }).originalCmd;
        if (cmd) {
            const match = cmd.match(/file_(\d+)/);
            if (match) {
                return Number(match[1]);
            }
            return hashString(cmd);
        }
        return Number(episode.id);
    }

    if (customSid === 'vod-series') {
        const originalId = (episode as { originalId?: string | number })
            .originalId;
        const numericId = Number(originalId);
        return Number.isNaN(numericId)
            ? hashString(String(originalId))
            : numericId;
    }

    const numericId = Number(episode.id);
    return Number.isNaN(numericId) ? hashString(String(episode.id)) : numericId;
}

export function buildXtreamEpisodeDownloadRequest(options: {
    episode: XtreamSerieEpisode;
    context: XtreamEpisodeDownloadContext;
    playlistId: string;
    seriesId: number;
    seriesTitle: string;
    fallbackSeasonKey: string | undefined;
    posterUrl?: string;
}): XtreamEpisodeDownloadRequest {
    const { episode, context, playlistId, seriesId, seriesTitle } = options;
    const serverUrl = context.serverUrl?.replace(/\/$/, '') || '';
    const username = context.username || '';
    const password = context.password || '';
    const extension = episode.container_extension || 'mp4';
    const seasonNumber =
        episode.season || Number(options.fallbackSeasonKey) || 1;
    const episodeNumber = episode.episode_num || 1;
    const title = `${seriesTitle || 'Series'} - S${String(seasonNumber).padStart(
        2,
        '0'
    )}E${String(episodeNumber).padStart(2, '0')} - ${episode.title}`;

    return {
        playlistId,
        xtreamId: Number(episode.id),
        contentType: 'episode',
        title,
        url: `${serverUrl}/series/${username}/${password}/${episode.id}.${extension}`,
        posterUrl: options.posterUrl,
        seriesXtreamId: seriesId,
        seasonNumber,
        episodeNumber,
    };
}
