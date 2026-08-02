import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
import type {
    StalkerMappedEpisode,
    StalkerSelectedVodItem,
} from '@iptvnator/portal/stalker/data-access';
import type {
    Playlist,
    XtreamSerieEpisode,
    XtreamSerieEpisodeInfo,
} from '@iptvnator/shared/interfaces';
import { ELECTRON_BRIDGE_EPISODE_IDENTITY_SCOPES } from '@iptvnator/shared/interfaces';
import { createStalkerSeriesDownloadSnapshot } from './stalker-series-download-metadata';

type StalkerDownloadPlaylist = Pick<
    Playlist,
    | '_id'
    | 'title'
    | 'portalUrl'
    | 'macAddress'
    | 'userAgent'
    | 'referrer'
    | 'origin'
>;

export interface StalkerSeriesDownloadAdapterOptions {
    readonly playlist: StalkerDownloadPlaylist | null | undefined;
    readonly item: StalkerSelectedVodItem | null | undefined;
    readonly language: string;
    readonly seriesId: number;
    readonly seriesMode: StalkerSeriesDownloadMode;
    readonly resolveUrl: (
        command: string,
        episodeNumber: number
    ) => Promise<string>;
}

export const STALKER_SERIES_DOWNLOAD_MODES = {
    EmbeddedVod: 'embedded-vod',
    LazyVod: 'lazy-vod',
    RegularSeries: 'regular-series',
} as const;

export type StalkerSeriesDownloadMode =
    (typeof STALKER_SERIES_DOWNLOAD_MODES)[keyof typeof STALKER_SERIES_DOWNLOAD_MODES];

const IDENTITY_SCOPE_BY_MODE = {
    [STALKER_SERIES_DOWNLOAD_MODES.EmbeddedVod]:
        ELECTRON_BRIDGE_EPISODE_IDENTITY_SCOPES.StalkerEmbeddedVod,
    [STALKER_SERIES_DOWNLOAD_MODES.LazyVod]:
        ELECTRON_BRIDGE_EPISODE_IDENTITY_SCOPES.StalkerLazyVod,
    [STALKER_SERIES_DOWNLOAD_MODES.RegularSeries]:
        ELECTRON_BRIDGE_EPISODE_IDENTITY_SCOPES.StalkerRegularSeries,
} as const;

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

function playbackCommand(episode: XtreamSerieEpisode): string {
    const mappedEpisode = episode as StalkerMappedEpisode;
    return mappedEpisode.custom_sid === 'vod-series'
        ? `/media/file_${mappedEpisode.originalId}.mpg`
        : (mappedEpisode.originalCmd ?? '');
}

export function createStalkerSeriesDownloadAdapter(
    options: StalkerSeriesDownloadAdapterOptions
): SeasonEpisodeDownloadAdapter {
    return {
        createCandidate(episode, fallbackSeasonKey) {
            const playlist = options.playlist;
            const item = options.item;
            const xtreamId = positiveSafeInteger(episode.id);
            const seriesXtreamId = positiveSafeInteger(options.seriesId);
            const seasonNumber = positiveSafeInteger(
                episode.season || Number(fallbackSeasonKey) || 1
            );
            const episodeNumber = positiveSafeInteger(episode.episode_num || 1);
            const episodeIdentityScope =
                IDENTITY_SCOPE_BY_MODE[options.seriesMode];

            if (
                !playlist ||
                !item ||
                !isPresent(playlist._id) ||
                !isPresent(playlist.portalUrl) ||
                !isPresent(playlist.macAddress) ||
                !isPresent(options.language) ||
                xtreamId === null ||
                seriesXtreamId === null ||
                seasonNumber === null ||
                episodeNumber === null
            ) {
                return null;
            }

            const identity = {
                playlistId: playlist._id,
                contentType: 'episode' as const,
                xtreamId,
                seriesXtreamId,
                seasonNumber,
                episodeNumber,
                episodeIdentityScope,
            };

            return {
                identity,
                prepare: async () => {
                    const url = await options.resolveUrl(
                        playbackCommand(episode),
                        episodeNumber
                    );
                    if (!isPresent(url)) {
                        throw new Error('Unable to prepare episode download');
                    }

                    const info = episodeInfo(episode);
                    const seriesTitle = item.info?.name || 'Series';
                    const episodeCode = `S${String(seasonNumber).padStart(
                        2,
                        '0'
                    )}E${String(episodeNumber).padStart(2, '0')}`;

                    return {
                        ...identity,
                        title: `${seriesTitle} - ${episodeCode} - ${episode.title}`,
                        url,
                        posterUrl: info?.movie_image,
                        metadataSnapshot: createStalkerSeriesDownloadSnapshot({
                            item,
                            episode,
                            language: options.language,
                            seriesTitle,
                            seasonNumber,
                            episodeNumber,
                        }),
                        headers: {
                            userAgent: playlist.userAgent,
                            referer: playlist.referrer,
                            origin: playlist.origin,
                        },
                        playlistName: playlist.title || 'Stalker Portal',
                        playlistType: 'stalker',
                        portalUrl: playlist.portalUrl,
                        macAddress: playlist.macAddress,
                    };
                },
            };
        },
    };
}
