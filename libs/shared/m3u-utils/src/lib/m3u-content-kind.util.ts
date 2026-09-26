import { isDashStreamUrl } from './dash.utils';
import { getPlaybackMediaExtensionFromUrl } from './playback-media-extension.util';
import {
    hasStrongEpisodeCode,
    isVodContainerExtension,
} from './m3u-vod-detection.util';

/**
 * What an M3U entry actually is, so the catalog can stop presenting films and
 * episodes as live channels.
 *
 * On a real 62,696-entry playlist only 4,699 rows are live: 17,902 are
 * movies and 40,095 are series episodes. Everything in the app treats them
 * identically today, which is why a viewer scrolls a 62k flat list to find
 * a channel.
 *
 * ## The asymmetry that sets the rule order
 *
 * A live stream misread as a movie swaps the EPG zone away from a working
 * channel — visible, wrong, and reported as a bug. A movie left classified
 * as live only keeps today's behaviour. So every ambiguity resolves toward
 * `live`, and the streaming containers and the `/live/` path segment win
 * over anything the name says.
 */
export type M3uContentKind = 'live' | 'movie' | 'episode' | 'radio';

/**
 * The three fields the decision reads.
 *
 * Structural rather than `Pick<Channel, …>`: the same rule has to answer for
 * a stored `Channel`, for a freshly parsed playlist item, and for a partial
 * row in a test, and those disagree about which fields are optional.
 */
export interface M3uClassifiableEntry {
    readonly url?: string | null;
    readonly name?: string | null;
    readonly radio?: string | null;
}

const SERIES_SEGMENT = '/series/';
const LIVE_SEGMENT = '/live/';
const MOVIE_SEGMENTS = ['/movie/', '/movies/', '/vod/'];

/**
 * The path, lowercased, with query and fragment removed — without building a
 * `URL`.
 *
 * Measured over 62,696 entries: `new URL(url).pathname.split('/')` costs
 * 26.7 ms, this costs 2.1 ms. The index is rebuilt whenever a playlist
 * loads, so the difference is a visible stall rather than a micro-optimisation.
 * Segment-exactness is preserved because the delimiters are part of each
 * needle.
 */
function pathOf(url: string): string {
    const schemeEnd = url.indexOf('://');
    const afterScheme = schemeEnd === -1 ? 0 : schemeEnd + 3;
    const pathStart = url.indexOf('/', afterScheme);
    if (pathStart === -1) {
        return '/';
    }

    let end = url.length;
    const query = url.indexOf('?', pathStart);
    if (query !== -1) end = query;
    const fragment = url.indexOf('#', pathStart);
    if (fragment !== -1 && fragment < end) end = fragment;

    return url.slice(pathStart, end).toLowerCase();
}

/**
 * Classifies one entry. Pure and synchronous: the catalog index runs it over
 * every row of a playlist, and the player asks it for a single channel the
 * moment one is activated.
 */
export function classifyM3uEntry(
    channel: M3uClassifiableEntry | null | undefined
): M3uContentKind {
    const url = channel?.url;
    if (!url) {
        return 'live';
    }

    // The radio attribute is the app's existing audio-player gate; it
    // outranks every URL signal, exactly as the player does.
    if (channel.radio === 'true') {
        return 'radio';
    }

    // DASH has its own routing path and is never treated as VOD.
    if (isDashStreamUrl(url)) {
        return 'live';
    }

    const path = pathOf(url);

    // The guard that protects working channels comes FIRST, because the
    // stated rule is that live wins: a stream published under
    // `/live/user/series/123.ts` is a channel whose path happens to contain
    // the word, and checking `/series/` ahead of it would file it as an
    // episode.
    if (path.includes(LIVE_SEGMENT)) {
        return 'live';
    }

    if (path.includes(SERIES_SEGMENT)) {
        return 'episode';
    }

    const name = channel.name;

    if (MOVIE_SEGMENTS.some((segment) => path.includes(segment))) {
        return hasStrongEpisodeCode(name) ? 'episode' : 'movie';
    }

    // No path evidence left; the container is the remaining signal. A `.ts`,
    // `.m3u8` or extension-less URL is how live is delivered, so it falls
    // through to live below.
    if (isVodContainerExtension(getPlaybackMediaExtensionFromUrl(url))) {
        // The SAME strong-code rule as under `/movie/`. Accepting weak
        // markers here would give one name two different answers depending
        // on a path that said nothing at all: "KILL BILL: BÖLÜM 2" would be
        // a film under `/movie/` and an episode as a bare `.mp4`. Word
        // order is what separates a film instalment from an episode, and
        // that does not change with the URL.
        return hasStrongEpisodeCode(name) ? 'episode' : 'movie';
    }

    return 'live';
}

/**
 * The collection surfaces model content as live / movie / series, with no
 * separate episode kind, so an episode row is filed under the show it
 * belongs to. Radio is live audio and the collection item carries its own
 * `radio` flag, so it stays live here rather than inventing a fourth kind
 * those surfaces would have to learn.
 */
export function m3uCollectionContentType(
    channel: M3uClassifiableEntry | null | undefined
): 'live' | 'movie' | 'series' {
    switch (classifyM3uEntry(channel)) {
        case 'movie':
            return 'movie';
        case 'episode':
            return 'series';
        default:
            return 'live';
    }
}
