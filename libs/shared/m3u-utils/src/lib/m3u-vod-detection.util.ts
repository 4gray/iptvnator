import {
    Channel,
    SEASON_WORD_ALTERNATIVES,
} from '@iptvnator/shared/interfaces';
import { isDashStreamUrl } from './dash.utils';
import { getPlaybackMediaExtensionFromUrl } from './playback-media-extension.util';

/**
 * Heuristic that decides whether an M3U entry is a movie FILE rather than a
 * live stream, so the player can present the VOD detail experience (TMDB
 * metadata instead of the EPG zone).
 *
 * The decision must be synchronous — the layout is chosen the moment a
 * channel is activated, before any TMDB request — so it reads only what the
 * playlist itself states: the URL shape and the entry name. It is
 * deliberately conservative: a false negative keeps today's behavior, while
 * a false positive would swap the EPG zone away from a live channel.
 */

/**
 * File containers that only ever carry finished assets. Streaming
 * packagings are deliberately absent: `.ts`/`.m3u8`/`.m4s` are how LIVE
 * channels are delivered, and `.mpd` (DASH) has its own routing path.
 * Audio extensions are absent too — an audio file is not a movie.
 */
const MOVIE_CONTAINER_EXTENSIONS = new Set([
    'avi',
    'asf',
    'divx',
    'flv',
    'm2ts',
    'm4v',
    'mkv',
    'mov',
    'mp4',
    'mpeg',
    'mpg',
    'rm',
    'rmvb',
    'vob',
    'webm',
    'wmv',
]);

/**
 * Xtream-derived M3U exports address VOD as `/movie/<user>/<pass>/<id>`,
 * often without a file extension. The segment is a strong VOD signal on its
 * own, whatever the container (some panels serve HLS VOD under it).
 * `/series/` is the same panels' EPISODE namespace — those are series
 * content, which v1 does not recognize.
 */
const MOVIE_PATH_SEGMENTS = new Set(['movie', 'movies', 'vod']);
const SERIES_PATH_SEGMENT = 'series';

/**
 * Episode markers in the entry name: "S01E01", "s1.e2", "1x02",
 * "Episode 5", "2 серия", "Season 3" (word list shared with the season
 * stripper in title-normalization). A marked entry is a series episode, not
 * a movie — v1 skips those rather than mis-enriching them as films.
 * Known cost: "Star Wars: Episode 1" is skipped too; that only keeps the
 * current live-style view, which is the safe direction.
 *
 * `(?:^|[^\p{L}])` guards instead of `\b`: JS word boundaries are
 * ASCII-only and never fire next to Cyrillic letters.
 */
const EPISODE_WORD_ALTERNATIVES =
    'episode|episodio|folge|серия|эпизод|bölüm|odcinek|aflevering';
const SEASON_OR_EPISODE_WORD = `(?:${SEASON_WORD_ALTERNATIVES}|${EPISODE_WORD_ALTERNATIVES})`;

const SEASON_EPISODE_CODE =
    /(?:^|[^a-z0-9])s\d{1,2}[\s._-]*e\d{1,3}(?![a-z0-9])/i;
// Requires a 2–3 digit episode part, so short film titles like "4x4" survive
const CROSS_EPISODE_CODE = /(?:^|[^0-9])\d{1,2}x\d{2,3}(?![0-9])/;
const WORD_FIRST_MARKER = new RegExp(
    `(?:^|[^\\p{L}])${SEASON_OR_EPISODE_WORD}[\\s._-]*\\d{1,3}(?!\\d)`,
    'iu'
);
const NUMBER_FIRST_MARKER = new RegExp(
    `(?:^|[^\\p{L}\\d])\\d{1,2}[\\s._-]*(?:st|nd|rd|th|й|и|я|ой|ои)?[\\s._-]*${SEASON_OR_EPISODE_WORD}(?:$|[^\\p{L}])`,
    'iu'
);

export function hasEpisodeMarker(name: string | null | undefined): boolean {
    if (!name) {
        return false;
    }

    return (
        SEASON_EPISODE_CODE.test(name) ||
        CROSS_EPISODE_CODE.test(name) ||
        WORD_FIRST_MARKER.test(name) ||
        NUMBER_FIRST_MARKER.test(name)
    );
}

function pathSegmentsOf(url: string): string[] {
    try {
        return new URL(url, 'http://iptvnator.local').pathname
            .split('/')
            .filter((segment) => segment !== '')
            .map((segment) => segment.toLowerCase());
    } catch {
        return [];
    }
}

export function isLikelyM3uMovie(
    channel: Pick<Channel, 'url' | 'name' | 'radio'> | null | undefined
): boolean {
    const url = channel?.url;
    if (!url || channel.radio === 'true' || isDashStreamUrl(url)) {
        return false;
    }

    if (hasEpisodeMarker(channel.name)) {
        return false;
    }

    const segments = pathSegmentsOf(url);
    if (segments.includes(SERIES_PATH_SEGMENT)) {
        return false;
    }

    return (
        MOVIE_CONTAINER_EXTENSIONS.has(getPlaybackMediaExtensionFromUrl(url)) ||
        segments.some((segment) => MOVIE_PATH_SEGMENTS.has(segment))
    );
}
