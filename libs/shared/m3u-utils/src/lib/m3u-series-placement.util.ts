import { M3uArtworkBearing, M3uSeriesEpisode } from './m3u-series-model';

/**
 * Where an episode row goes inside its season.
 *
 * One rule runs through both functions: a row that plays differently is
 * never hidden behind another row. The split has taken every episode row out
 * of the channel list, so a row parked where nothing reads it plays nowhere.
 * Only the same stream again — the same URL with the same request headers
 * and DRM, i.e. the same row twice — is parked.
 */

type Season<T> = Map<number, M3uSeriesEpisode<T>>;

/** The fields besides the URL that change how a row plays. */
interface M3uPlaybackFields {
    readonly url?: string | null;
    readonly http?: {
        readonly referrer?: string | null;
        readonly 'user-agent'?: string | null;
        readonly origin?: string | null;
    } | null;
    readonly drm?: unknown;
}

/**
 * What decides how a row plays: its URL, plus its request headers and DRM
 * when it states any. A row with neither is keyed on its URL alone, so the
 * ids derived from this key stay what they were for such rows.
 */
export function m3uPlaybackKey(channel: M3uPlaybackFields): string {
    const url = channel.url ?? '';
    const http = channel.http;
    const headers = [
        http?.referrer ?? '',
        http?.['user-agent'] ?? '',
        http?.origin ?? '',
    ];
    const drm = channel.drm ? JSON.stringify(channel.drm) : '';
    if (!drm && headers.every((value) => !value)) {
        return url;
    }
    return [url, ...headers, drm].join('\u0000');
}

/** The last path segment, lowercased, without query or fragment. */
export function fileNameOf(url: string | null | undefined): string {
    const path = (url ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
    return path.slice(path.lastIndexOf('/') + 1).toLowerCase();
}

function park<T extends M3uArtworkBearing>(
    season: Season<T>,
    key: number,
    held: M3uSeriesEpisode<T>,
    episode: M3uSeriesEpisode<T>
): void {
    season.set(key, {
        ...held,
        alternatives: [
            ...held.alternatives,
            episode.channel,
            ...episode.alternatives,
        ],
    });
}

/**
 * Files an episode at the season×episode it states.
 *
 * The first row at a coordinate holds it, and with it the id derived from
 * the coordinate. A later row there with another URL — a second quality, a
 * "Part 2", a trailer, or an episode of a show whose title merely
 * normalizes the same — is listed next to it under the same number, with
 * an id keyed on its own row (`rowKey`). An unnumbered row sitting in the
 * slot gives it up: its number was only its place in the list.
 */
export function placeNumberedEpisode<T extends M3uArtworkBearing>(
    season: Season<T>,
    episode: M3uSeriesEpisode<T>
): void {
    const number = episode.episodeNumber;
    const occupant = season.get(number);
    if (!occupant) {
        season.set(number, episode);
        return;
    }
    if (occupant.unnumbered) {
        season.set(number, episode);
        placeUnnumberedEpisode(season, occupant);
        return;
    }

    // Further rows of one number sit at fractional keys, which keeps the
    // map ordered by episode without a second container.
    for (let extra = 0; ; extra += 1) {
        const key = number + extra / 1000;
        const held = season.get(key);
        if (!held) {
            season.set(key, {
                ...episode,
                rowKey: episode.rowKey ?? fileNameOf(episode.channel.url),
            });
            return;
        }
        if (m3uPlaybackKey(held.channel) === m3uPlaybackKey(episode.channel)) {
            park(season, key, held, episode);
            return;
        }
    }
}

/**
 * Lists a row the parser read no number from at the next free slot of its
 * season. The slot is only where it is listed: its id is keyed on
 * `rowKey`, because the slot moves when the provider reorders rows or adds
 * a numbered episode.
 */
export function placeUnnumberedEpisode<T extends M3uArtworkBearing>(
    season: Season<T>,
    episode: M3uSeriesEpisode<T>
): void {
    let last = 0;
    for (const [key, held] of season) {
        if (m3uPlaybackKey(held.channel) === m3uPlaybackKey(episode.channel)) {
            park(season, key, held, episode);
            return;
        }
        last = Math.max(last, Math.floor(key));
    }

    season.set(last + 1, {
        ...episode,
        episodeNumber: last + 1,
        unnumbered: true,
        rowKey: episode.rowKey ?? fileNameOf(episode.channel.url),
    });
}
