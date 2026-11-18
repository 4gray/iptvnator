import { getPortalPlaybackProgressPercent } from '@iptvnator/portal/shared/util';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    formatSeriesEpisodeLabel,
    type SeriesPlaybackEpisodeLike,
} from './series-playback-navigation';

/**
 * Episode entry rendered by the "Up Next" side rail next to the inline
 * series player. Carries the host's raw episode object so selection can be
 * routed back through the host's existing episode-play flow without an
 * id lookup.
 */
export interface UpNextRailItem<TEpisode = unknown> {
    id: number;
    /** `SxxEyy` label. */
    label: string;
    title: string;
    thumbnailUrl: string | null;
    /** Watch progress in percent (0–100); null when never started. */
    progressPercent: number | null;
    isPlaying: boolean;
    episode: TEpisode;
}

interface UpNextEpisodeLike extends SeriesPlaybackEpisodeLike {
    info?: { movie_image?: string } | unknown[];
}

export interface BuildUpNextRailItemsOptions<
    TEpisode extends UpNextEpisodeLike,
> {
    episodesBySeason: Record<string, readonly TEpisode[]> | null | undefined;
    /** Id of the episode currently playing inline; no rail without one. */
    currentEpisodeId: string | number | null | undefined;
    playbackPositions?: ReadonlyMap<number, PlaybackPositionData> | null;
    /** Lazy seasons whose successors are still unknown. */
    pendingSeasons?: Readonly<Record<string, 'loading' | 'unloaded'>>;
    /** Max entries including the playing episode. */
    limit?: number;
}

const DEFAULT_LIMIT = 12;

/**
 * Builds the "Up Next" list for the inline series player: the currently
 * playing episode (highlighted) followed by the rest of its season and a
 * spillover into the following seasons, with per-episode watch progress.
 */
export function buildUpNextRailItems<TEpisode extends UpNextEpisodeLike>({
    episodesBySeason,
    currentEpisodeId,
    playbackPositions,
    pendingSeasons,
    limit = DEFAULT_LIMIT,
}: BuildUpNextRailItemsOptions<TEpisode>): UpNextRailItem<TEpisode>[] {
    if (
        !episodesBySeason ||
        currentEpisodeId === null ||
        currentEpisodeId === undefined
    ) {
        return [];
    }

    return flattenFromPlaying(
        episodesBySeason,
        currentEpisodeId,
        pendingSeasons
    )
        .slice(0, Math.max(0, limit))
        .map(({ episode, seasonNumber, episodeNumber }, index) => ({
            id: Number(episode.id),
            label: formatSeriesEpisodeLabel(
                seasonNumber,
                episodeNumber,
                episode.seasonUnknown
            ),
            title: episode.title ?? '',
            thumbnailUrl: getEpisodeThumbnail(episode),
            progressPercent: getProgressPercent(
                playbackPositions?.get(Number(episode.id))
            ),
            isPlaying: index === 0,
            episode,
        }));
}

interface FlattenedEpisode<TEpisode> {
    episode: TEpisode;
    seasonNumber: number;
    episodeNumber: number;
}

/**
 * Flattens the season map into playback order. Season keys are sorted
 * numerically when possible (object key order is not reliable for numeric
 * strings mixed with names); non-numeric keys keep their insertion order
 * after the numeric ones.
 */
function flattenFromPlaying<TEpisode extends UpNextEpisodeLike>(
    episodesBySeason: Record<string, readonly TEpisode[]>,
    currentEpisodeId: string | number,
    pendingSeasons: BuildUpNextRailItemsOptions<TEpisode>['pendingSeasons']
): FlattenedEpisode<TEpisode>[] {
    interface SeasonEntry {
        seasonKey: string;
        episodes: readonly TEpisode[];
        entryIndex: number;
    }

    const entries: SeasonEntry[] = Object.entries(episodesBySeason).map(
        ([seasonKey, episodes], entryIndex) => ({
            seasonKey,
            episodes,
            entryIndex,
        })
    );

    entries.sort((a, b) => {
        const aNumber = Number(a.seasonKey);
        const bNumber = Number(b.seasonKey);
        const aNumeric = Number.isFinite(aNumber);
        const bNumeric = Number.isFinite(bNumber);
        if (aNumeric && bNumeric) {
            return aNumber - bNumber;
        }
        if (aNumeric !== bNumeric) {
            return aNumeric ? -1 : 1;
        }
        return a.entryIndex - b.entryIndex;
    });

    // No Array.flatMap: the e2e build config targets a lib without it.
    const flattened: FlattenedEpisode<TEpisode>[] = [];
    let playingFound = false;
    for (const { seasonKey, episodes } of entries) {
        if (playingFound && pendingSeasons?.[seasonKey]) break;
        for (const [episodeIndex, episode] of episodes.entries()) {
            playingFound ||= Number(episode.id) === Number(currentEpisodeId);
            if (!playingFound) continue;
            flattened.push({
                episode,
                seasonNumber: Number(episode.season) || Number(seasonKey) || 0,
                episodeNumber: Number(episode.episode_num) || episodeIndex + 1,
            });
        }
    }
    return flattened;
}

function getEpisodeThumbnail(episode: UpNextEpisodeLike): string | null {
    const info = episode.info;
    if (!info || Array.isArray(info)) {
        return null;
    }

    const url = info.movie_image;
    return url && /^https?:/i.test(url) ? url : null;
}

function getProgressPercent(
    position: PlaybackPositionData | undefined
): number | null {
    if (!position || !position.positionSeconds) {
        return null;
    }

    const percent = getPortalPlaybackProgressPercent(position);
    return percent > 0 ? percent : null;
}
