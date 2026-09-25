import {
    getPortalPlaybackProgressPercent,
    isPortalPlaybackWatched,
} from '@iptvnator/portal/shared/util';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { formatSeriesEpisodeLabel } from '../portal-inline-player/series-playback-navigation';
import type { UpNextRailItem } from '../portal-inline-player/up-next-rail.util';

/**
 * The slice of an episode object the panel reads. Structural on purpose:
 * both portals hand the inline player the Xtream episode shape
 * (`XtreamSerieEpisode`, Stalker through `mappedSeasons`), and the TMDB
 * overlay writes its stills and overviews into the same `info` fields.
 */
export interface FullscreenPanelEpisodeLike {
    id: string | number;
    season?: string | number;
    episode_num?: string | number;
    title?: string;
    info?:
        | {
              movie_image?: string;
              plot?: string;
              duration_secs?: number;
              duration?: string;
          }
        | unknown[];
}

/**
 * One row of the fullscreen episode panel. Extends the Up Next entry so a
 * click can travel the exact path the rail's click does: the host receives
 * the same object shape and plays `episode` through its inline flow.
 */
export interface FullscreenEpisodePanelItem<
    TEpisode = unknown,
> extends UpNextRailItem<TEpisode> {
    seasonKey: string;
    /** Number inside its season, the fallback tile when there is no still. */
    episodeNumber: number;
    /** TMDB or provider overview, empty when neither says anything. */
    overview: string;
    /** "45 min" style runtime, null when the provider states none. */
    durationLabel: string | null;
    /** Watched (≥90 %) per the shared portal progress rule. */
    watched: boolean;
}

/**
 * Where a season's episode list stands with the portal. Every Xtream season
 * is `loaded` up front; a Stalker lazy VOD season is `loading` while its
 * request is on the wire and `unloaded` while the portal has not answered
 * yet — after a failed request too, which is why the panel offers a retry
 * there instead of a spinner that nothing would ever end.
 */
export type FullscreenPanelSeasonLoadState = 'loaded' | 'loading' | 'unloaded';

export interface FullscreenEpisodePanelSeason<TEpisode = unknown> {
    /** Provider season key, as the season container uses it. */
    key: string;
    episodes: FullscreenEpisodePanelItem<TEpisode>[];
    loadState: FullscreenPanelSeasonLoadState;
    /** The season's own poster (TMDB or provider), when the host has one. */
    posterUrl?: string;
}

export interface BuildFullscreenEpisodePanelSeasonsOptions<
    TEpisode extends FullscreenPanelEpisodeLike,
> {
    episodesBySeason: Record<string, readonly TEpisode[]> | null | undefined;
    /** Id of the episode playing inline; its row carries the marker. */
    currentEpisodeId: string | number | null | undefined;
    playbackPositions?: ReadonlyMap<number, PlaybackPositionData> | null;
    /** Per season key, in flight or not yet answered; absent means loaded. */
    seasonLoadStates?: Readonly<
        Record<string, Exclude<FullscreenPanelSeasonLoadState, 'loaded'>>
    > | null;
    /** Per season key, the season's poster URL; absent means none known. */
    seasonPosters?: Readonly<Record<string, string>> | null;
}

/**
 * Builds the panel's seasons in display order: numeric keys ascending,
 * non-numeric keys afterwards in insertion order — the same order the Up
 * Next rail flattens seasons in, so both surfaces agree on "next".
 */
export function buildFullscreenEpisodePanelSeasons<
    TEpisode extends FullscreenPanelEpisodeLike,
>({
    episodesBySeason,
    currentEpisodeId,
    playbackPositions,
    seasonLoadStates,
    seasonPosters,
}: BuildFullscreenEpisodePanelSeasonsOptions<TEpisode>): FullscreenEpisodePanelSeason<TEpisode>[] {
    if (!episodesBySeason) {
        return [];
    }

    const currentId =
        currentEpisodeId === null || currentEpisodeId === undefined
            ? null
            : Number(currentEpisodeId);

    return sortSeasonKeys(Object.keys(episodesBySeason)).map((seasonKey) => {
        const episodes = episodesBySeason[seasonKey] ?? [];
        const posterUrl = seasonPosters?.[seasonKey];
        return {
            key: seasonKey,
            loadState: seasonLoadStates?.[seasonKey] ?? 'loaded',
            ...(posterUrl ? { posterUrl } : {}),
            episodes: episodes.map((episode, index) =>
                toPanelItem(
                    episode,
                    seasonKey,
                    index,
                    currentId,
                    playbackPositions
                )
            ),
        };
    });
}

function toPanelItem<TEpisode extends FullscreenPanelEpisodeLike>(
    episode: TEpisode,
    seasonKey: string,
    index: number,
    currentId: number | null,
    playbackPositions:
        ReadonlyMap<number, PlaybackPositionData> | null | undefined
): FullscreenEpisodePanelItem<TEpisode> {
    const id = Number(episode.id);
    const info = readInfo(episode);
    const position = playbackPositions?.get(id);
    const percent = position ? getPortalPlaybackProgressPercent(position) : 0;
    const seasonNumber = Number(episode.season) || Number(seasonKey) || 0;
    const episodeNumber = Number(episode.episode_num) || index + 1;

    return {
        id,
        seasonKey,
        episodeNumber,
        label: formatSeriesEpisodeLabel(seasonNumber, episodeNumber),
        title: episode.title?.trim() ?? '',
        thumbnailUrl: toHttpUrl(info?.movie_image),
        overview: info?.plot?.trim() ?? '',
        durationLabel: formatEpisodeDuration(
            info?.duration_secs,
            info?.duration
        ),
        progressPercent: percent > 0 ? percent : null,
        watched: isPortalPlaybackWatched(position),
        isPlaying: currentId !== null && id === currentId,
        episode,
    };
}

function readInfo(episode: FullscreenPanelEpisodeLike) {
    const info = episode.info;
    return !info || Array.isArray(info) ? null : info;
}

function toHttpUrl(url: string | undefined): string | null {
    return url && /^https?:/i.test(url) ? url : null;
}

/**
 * Whole minutes from the provider's numeric runtime, else from the text
 * forms the portals use — "45 min", "1h 30min", "01:30:00", "45:00".
 * Returns null for anything that does not parse to a positive runtime.
 */
export function formatEpisodeDuration(
    durationSeconds: number | undefined,
    duration: string | undefined
): string | null {
    const seconds =
        typeof durationSeconds === 'number' && durationSeconds > 0
            ? durationSeconds
            : parseDurationText(duration);
    if (!seconds || !Number.isFinite(seconds)) {
        return null;
    }
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `${minutes} min`;
}

function parseDurationText(duration: string | undefined): number {
    if (!duration) {
        return 0;
    }
    const minutesMatch = duration.match(/(?:(\d+)\s*h\w*)?\s*(\d+)\s*min/);
    if (minutesMatch) {
        return (
            parseInt(minutesMatch[1] ?? '0', 10) * 3600 +
            parseInt(minutesMatch[2], 10) * 60
        );
    }
    const parts = duration.split(':').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2 && parts.every(Number.isFinite)) {
        return parts[0] * 60 + parts[1];
    }
    return 0;
}

/** Numeric keys ascending, then non-numeric keys in insertion order. */
export function sortSeasonKeys(keys: readonly string[]): string[] {
    return keys
        .map((key, index) => ({ key, index, numeric: Number(key) }))
        .sort((a, b) => {
            const aNumeric = Number.isFinite(a.numeric);
            const bNumeric = Number.isFinite(b.numeric);
            if (aNumeric && bNumeric) {
                return a.numeric - b.numeric;
            }
            if (aNumeric !== bNumeric) {
                return aNumeric ? -1 : 1;
            }
            return a.index - b.index;
        })
        .map(({ key }) => key);
}
