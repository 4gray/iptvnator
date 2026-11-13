import { isDashStreamUrl } from './dash.utils';
import { getPlaybackMediaExtensionFromUrl } from './playback-media-extension.util';
import { hasStrongEpisodeCode } from './m3u-episode-code.util';
import { VOD_CONTAINER_EXTENSIONS } from './m3u-vod-detection.util';

/**
 * What an M3U entry actually is, so the catalog can stop presenting films and
 * episodes as live channels.
 *
 * On a large playlist (~63k rows) only about 7% of rows are live: roughly
 * 29% are movies and 64% are series episodes. Everything in the app treats
 * them identically today, which is why a viewer scrolls a ~63k-row flat list
 * to find a channel.
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
    /**
     * Read for the guide id and the `tvg-rec` archive depth; a file has no
     * programme schedule.
     */
    readonly tvg?: {
        readonly id?: string | null;
        readonly rec?: string | null;
    } | null;
    /** A catch-up window only exists for a broadcast. */
    readonly catchup?: {
        readonly type?: string | null;
        readonly days?: string | null;
        readonly source?: string | null;
    } | null;
    /** The `timeshift` attribute, another spelling of the archive depth. */
    readonly timeshift?: string | null;
}

const SERIES_SEGMENT = '/series/';
const LIVE_SEGMENT = '/live/';
/**
 * The Xtream export path. It names VOD on its own, whatever the container:
 * some panels serve HLS films under it.
 */
const XTREAM_MOVIE_SEGMENT = '/movie/';
/**
 * Folder names, not a panel API. A provider can call a genre channel's
 * folder `movies` (`/movies/action/index.m3u8`), so under these a streaming
 * container stays live.
 */
const LOOSE_MOVIE_SEGMENTS = ['/movies/', '/vod/'];
/** How live is packaged: a file named like this is a stream, not a film. */
const STREAMING_EXTENSIONS = new Set(['m3u8', 'm3u', 'ts']);
/**
 * HTTP-FLV is a live delivery protocol (common in Chinese playlists): a bare
 * `.flv` is evidence of a stream, not of a file. Under a movie path it is
 * still a film.
 */
const LIVE_FILE_EXTENSIONS = new Set(['flv']);
/** What `isDashStreamUrl` compares the playback extension with. */
const DASH_EXTENSION = 'mpd';

/**
 * Whether the row states a broadcast: a guide id or a catch-up window. A
 * film or an episode file has neither, so either is enough to keep a row
 * with nothing but a container extension in the live list.
 *
 * The values are read, not the objects: the playlist parser gives EVERY row
 * a `tvg` and a `catchup` object with blank fields, so their presence says
 * nothing. The catch-up window is any of the spellings `getM3uArchiveDays`
 * and the catch-up resolver accept.
 */
function hasBroadcastEvidence(channel: M3uClassifiableEntry): boolean {
    const { tvg, catchup, timeshift } = channel;
    // Spelled out rather than looped: this runs for every file row of a
    // playlist, and an array per row is the kind of cost the index budget
    // exists to catch.
    return (
        isStated(tvg?.id) ||
        isStated(tvg?.rec) ||
        isStated(timeshift) ||
        isStated(catchup?.type) ||
        isStated(catchup?.days) ||
        isStated(catchup?.source)
    );
}

function isStated(value: string | null | undefined): boolean {
    return !!value && value.trim() !== '';
}

/**
 * A release year as its own token: "Sandline (2021)", "Dry Canyon [2015]",
 * "THE GLASS HARBOR - 2025", "Iron Harbor 2014 1080p". The `(?![\p{L}\p{N}])`
 * guard keeps resolutions and ids such as "2160p" or "19999" out.
 */
const RELEASE_YEAR = /(?:^|[^\p{L}\p{N}])(?:19|20)\d{2}(?![\p{L}\p{N}])/u;

function hasReleaseYear(name: string | null | undefined): boolean {
    return !!name && RELEASE_YEAR.test(name);
}

/**
 * The path, lowercased, with query and fragment removed — without building a
 * `URL`.
 *
 * Measured over ~63k entries: `new URL(url).pathname.split('/')` costs
 * 26.7 ms, this costs 2.1 ms. The index is rebuilt whenever a playlist
 * loads, so the difference is a visible stall rather than a micro-optimisation.
 * Segment-exactness is preserved because the delimiters are part of each
 * needle.
 */
function pathOf(url: string): string {
    const schemeEnd = url.indexOf('://');
    const afterScheme = schemeEnd === -1 ? 0 : schemeEnd + 3;

    // The query and fragment end the path, and they can begin before any
    // path does ("https://h.example?next=/series/1.m3u8"); found first, a
    // slash inside them is never read as the start of the path.
    let end = url.length;
    const query = url.indexOf('?', afterScheme);
    if (query !== -1) end = query;
    const fragment = url.indexOf('#', afterScheme);
    if (fragment !== -1 && fragment < end) end = fragment;

    const pathStart = url.indexOf('/', afterScheme);
    if (pathStart === -1 || pathStart >= end) {
        return '/';
    }

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
        // A folder can be called `series` as it can be called `movies`. A
        // streaming container there that also states a broadcast is a
        // channel ("/hls/series/index.m3u8" with a guide id), not an
        // episode; everything else under the segment is one. The broadcast
        // check comes first: it is false for nearly every row here, which
        // spares them the extension parse.
        return hasBroadcastEvidence(channel) &&
            (STREAMING_EXTENSIONS.has(getPlaybackMediaExtensionFromUrl(url)) ||
                isDashStreamUrl(url))
            ? 'live'
            : 'episode';
    }

    // Read once: `isDashStreamUrl` is this same extension compared with
    // `mpd`, and every remaining row needs it.
    const extension = getPlaybackMediaExtensionFromUrl(url);

    // DASH has its own routing path and is never treated as VOD. It is
    // checked after `/series/`, because the series page plays a DASH
    // episode inline as the `:view` route does.
    if (extension === DASH_EXTENSION) {
        return 'live';
    }

    const name = channel.name;

    if (
        path.includes(XTREAM_MOVIE_SEGMENT) ||
        (LOOSE_MOVIE_SEGMENTS.some((segment) => path.includes(segment)) &&
            !STREAMING_EXTENSIONS.has(extension))
    ) {
        return hasStrongEpisodeCode(name) ? 'episode' : 'movie';
    }

    // No path evidence left; the container is the remaining signal. A `.ts`,
    // `.m3u8` or extension-less URL is how live is delivered, so it falls
    // through to live below. A container alone is weak evidence — 24/7 loop
    // channels are served as `.mp4`, HTTP-FLV live as `.flv` — and a hidden
    // live channel is the costly mistake, so a row that states a broadcast,
    // or uses a live file protocol, stays live.
    if (
        VOD_CONTAINER_EXTENSIONS.has(extension) &&
        !LIVE_FILE_EXTENSIONS.has(extension) &&
        !hasBroadcastEvidence(channel)
    ) {
        // The SAME strong-code rule as under `/movie/`. Accepting weak
        // markers here would give one name two different answers depending
        // on a path that said nothing at all: "GECE AVCISI: BÖLÜM 2" would be
        // a film under `/movie/` and an episode as a bare `.mp4`. Word
        // order is what separates a film instalment from an episode, and
        // that does not change with the URL.
        if (hasStrongEpisodeCode(name)) {
            return 'episode';
        }
        // A container alone does not make a film: hand-made playlists list
        // local clips and loop channels as `.mp4`/`.webm` under plain names,
        // and their viewers expect them in the channel list. With no path
        // to go on, only a name that reads like a film — one stating a
        // release year — leaves it.
        return hasReleaseYear(name) ? 'movie' : 'live';
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
