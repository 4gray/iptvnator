import type { Channel } from '@iptvnator/shared/interfaces';
import { hasEpisodeMarker, isLikelyM3uMovie, isLikelyM3uVod } from './m3u-vod-detection.util';

export type M3uContentKind = 'live' | 'movies' | 'series' | 'unclassified';

export interface M3uContentIndex {
    readonly live: Channel[];
    readonly movies: Channel[];
    readonly series: Channel[];
    readonly unclassified: Channel[];
}

function normalize(value: string | null | undefined): string {
    return (value ?? '')
        .normalize('NFKC')
        .toLocaleLowerCase('tr-TR')
        .trim();
}

/** Whole words rather than substrings: "diziler" must not match "dizilerden". */
const LIVE_GROUP = /(?:^|[^\p{L}])(?:ulusal|spor|canl[ıi]|kanallar[ıi]?|live\s*tv|live\s*channels|radio|radyo|yerel\s+kanallar|news\s+channels)(?:$|[^\p{L}])/iu;
const SERIES_GROUP = /(?:^|[^\p{L}])(?:dizi(?:ler|leri)?|series|serials|tv\s*shows|sezonlar|episodes|bölümler)(?:$|[^\p{L}])/iu;
const MOVIE_GROUP = /(?:^|[^\p{L}])(?:filmler(?:i)?|filmleri|filmler|film|movies|cinema|sinema|yeşilçam)(?:$|[^\p{L}])/iu;
const EPISODE_CODE = /(?:^|[^a-z0-9])s\d{1,2}[\s._-]*e\d{1,3}(?![a-z0-9])|(?:^|[^\d])\d{1,2}x\d{2,3}(?!\d)/i;
const PATH_LIVE = /\/(?:live|channels|radio)\//i;
const PATH_MOVIE = /\/(?:movie|movies|vod)\//i;
const PATH_SERIES = /\/series\//i;

function urlPath(url: string): string {
    try {
        return new URL(url, 'http://iptvnator.local').pathname;
    } catch {
        return '';
    }
}

/**
 * Classifies presentation only. Playback, favorites, M3U entry identity,
 * program mapping and stored source data are never mutated.
 *
 * Deliberately conservative: ambiguous metadata belongs to Unclassified.
 * In particular, ".m3u8"/".ts" alone does NOT imply live TV.
 */
export function classifyM3uContent(channel: Channel): M3uContentKind {
    if (channel.radio === 'true') return 'live';

    const group = normalize(channel.group?.title);
    const name = channel.name ?? '';
    const path = urlPath(channel.url ?? '');
    const liveGroup = LIVE_GROUP.test(group) && !SERIES_GROUP.test(group) && !MOVIE_GROUP.test(group);
    const movieGroup = MOVIE_GROUP.test(group) && !SERIES_GROUP.test(group);
    const seriesGroup = SERIES_GROUP.test(group) && !MOVIE_GROUP.test(group);
    const episodeCode = EPISODE_CODE.test(name);
    const episodeMarker = hasEpisodeMarker(name);

    // A film entitled "Star Wars: Episode 1" is not a series episode.
    if (PATH_SERIES.test(path)) return 'series';
    if (seriesGroup && (episodeMarker || !PATH_LIVE.test(path))) return 'series';
    if (episodeCode && !liveGroup) return 'series';

    if (liveGroup) return 'live';
    if (movieGroup) return 'movies';

    if (PATH_MOVIE.test(path) && !episodeMarker) return 'movies';
    if (PATH_MOVIE.test(path) && episodeMarker) return 'unclassified';
    if (PATH_LIVE.test(path)) return 'live';

    // Movie files and explicit episode markers are usable weak hints, but
    // do not override a known live/series/movie group.
    if (episodeMarker && isLikelyM3uVod(channel)) return 'series';
    if (isLikelyM3uMovie(channel)) return 'movies';
    return 'unclassified';
}

/** One linear classification pass, retaining original Channel references/order. */
export function buildM3uContentIndex(channels: readonly Channel[]): M3uContentIndex {
    const index: M3uContentIndex = {
        live: [],
        movies: [],
        series: [],
        unclassified: [],
    };
    for (const channel of channels) {
        index[classifyM3uContent(channel)].push(channel);
    }
    return index;
}
