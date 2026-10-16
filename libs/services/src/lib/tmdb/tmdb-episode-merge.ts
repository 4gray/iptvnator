import {
    XtreamSerieEpisode,
    XtreamSerieEpisodeInfo,
} from '@iptvnator/shared/interfaces';
import { tmdbStillUrl } from './tmdb-config';
import { TmdbEpisode } from './tmdb.types';

/**
 * Field-level merge of TMDB season data into an episode list (shared by
 * Xtream serial details and the Stalker series view, which map episodes to
 * the same `XtreamSerieEpisode` shape). Matching is by episode number.
 *
 * TMDB wins for editorial fields (real episode names, overviews, stills),
 * the provider keeps everything stream-related. Episodes without a TMDB
 * counterpart pass through untouched, so partial/missing TMDB data can
 * never degrade the list.
 */

/** Provider titles like "Episode 4", "4", "S01E04" carry no information */
const GENERIC_EPISODE_TITLE =
    /^(?:episode\s*\d+|серия\s*\d+|\d+|s\d{1,2}\s*e\d{1,3})$/i;

function isGenericEpisodeTitle(title: string | undefined | null): boolean {
    const trimmed = title?.trim() ?? '';
    return trimmed === '' || GENERIC_EPISODE_TITLE.test(trimmed);
}

function episodeInfoOf(
    episode: XtreamSerieEpisode
): Partial<XtreamSerieEpisodeInfo> {
    return !episode.info || Array.isArray(episode.info) ? {} : episode.info;
}

/** A runtime the provider sent: seconds, or a duration string that is not all zeros ("00:00:00"). */
function hasProviderRuntime(info: Partial<XtreamSerieEpisodeInfo>): boolean {
    return Number(info.duration_secs) > 0 || /[1-9]/.test(info.duration ?? '');
}

export function mergeEpisodesWithTmdb(
    episodes: readonly XtreamSerieEpisode[],
    tmdbEpisodes: readonly TmdbEpisode[]
): XtreamSerieEpisode[] {
    if (!tmdbEpisodes.length) {
        return [...episodes];
    }

    const byNumber = new Map(
        tmdbEpisodes.map((episode) => [episode.episode_number, episode])
    );

    return episodes.map((episode) => {
        const tmdb = byNumber.get(Number(episode.episode_num));
        if (!tmdb) {
            return episode;
        }

        const info = episodeInfoOf(episode);
        const still = tmdbStillUrl(tmdb.still_path);
        const rating =
            tmdb.vote_average && tmdb.vote_average > 0
                ? Math.round(tmdb.vote_average * 10) / 10
                : null;

        return {
            ...episode,
            // Real episode names beat generic "Episode 4" placeholders,
            // but a meaningful provider title is kept
            title:
                tmdb.name && isGenericEpisodeTitle(episode.title)
                    ? tmdb.name
                    : episode.title,
            info: {
                ...info,
                ...(tmdb.overview?.trim() ? { plot: tmdb.overview } : {}),
                ...(still ? { movie_image: still } : {}),
                releasedate: info.releasedate || (tmdb.air_date ?? ''),
                // Most Stalker portals send no runtime; TMDB's fills the
                // episode meta line. A provider runtime always wins.
                ...(!hasProviderRuntime(info) && (tmdb.runtime ?? 0) > 0
                    ? { duration_secs: Number(tmdb.runtime) * 60 }
                    : {}),
                ...(info.rating === undefined && rating !== null
                    ? { rating }
                    : {}),
            },
        };
    });
}
