import { extractDrmFromRaw } from './kodiprop.utils';
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
    /** The raw block, which older imports keep their KODIPROP DRM in. */
    readonly raw?: string;
}

/**
 * What decides how a row plays: its URL, plus its request headers and DRM
 * (stated, or carried in the raw block) when it has any. A row with neither is keyed on its URL alone, so the
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
    // The DRM the player will use: a playlist imported before the DRM field
    // existed keeps it only in the raw block (`buildM3uPlaybackPayload`).
    const effectiveDrm = channel.drm ?? extractDrmFromRaw(channel.raw);
    const drm = effectiveDrm ? JSON.stringify(effectiveDrm) : '';
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
    season.set(key, folded(held, episode));
}

/** `held` with `episode`'s rows listed among its alternatives. */
function folded<T extends M3uArtworkBearing>(
    held: M3uSeriesEpisode<T>,
    episode: M3uSeriesEpisode<T>
): M3uSeriesEpisode<T> {
    return {
        ...held,
        alternatives: [
            ...held.alternatives,
            episode.channel,
            ...episode.alternatives,
        ],
    };
}

/**
 * Files an episode at the season×episode it states.
 *
 * One row at a coordinate holds it, and with it the id derived from the
 * coordinate: of the rows that play differently there, the one
 * `holdsCoordinateBefore` ranks first, so a provider that reorders its rows
 * does not hand one file's watched mark and resume point to another. The
 * others — a
 * second quality, a "Part 2", a trailer, or an episode of a show whose
 * title merely normalizes the same — are listed next to it under the same
 * number, with an id keyed on their own row (`rowKey`). An unnumbered row
 * sitting in the slot gives it up: its number was only its place in the
 * list.
 */
export function placeNumberedEpisode<T extends M3uArtworkBearing>(
    season: Season<T>,
    episode: M3uSeriesEpisode<T>
): void {
    const number = episode.episodeNumber;
    const occupant = season.get(number);
    if (!occupant) {
        season.set(number, asHolder(episode));
        return;
    }
    if (occupant.unnumbered) {
        season.set(number, asHolder(episode));
        placeUnnumberedEpisode(season, occupant);
        return;
    }
    // The same stream again folds into the entry already listed for it,
    // which keeps two things true on every insert, whatever the row order:
    // an entry shows the best-ranked row of its stream, and the holder is
    // the entry with the best-ranked row of all.
    for (let extra = 0; ; extra += 1) {
        const key = number + extra / 1000;
        const held = season.get(key);
        if (!held) break;
        if (m3uPlaybackKey(held.channel) !== m3uPlaybackKey(episode.channel)) {
            continue;
        }
        const ranksFirst = holdsCoordinateBefore(episode.channel, held.channel);
        // The entry shows the stream's best-ranked row.
        const entry = ranksFirst
            ? folded({ ...episode, rowKey: held.rowKey }, held)
            : folded(held, episode);
        if (extra === 0) {
            season.set(key, asHolder(entry));
        } else if (holdsCoordinateBefore(entry.channel, occupant.channel)) {
            // The stream now has the best row of all: it takes the
            // coordinate, and the holder its slot, keyed on its own row.
            season.set(number, asHolder(entry));
            season.set(key, {
                ...occupant,
                rowKey: occupant.rowKey ?? fileNameOf(occupant.channel.url),
            });
        } else {
            season.set(key, entry);
        }
        return;
    }
    if (holdsCoordinateBefore(episode.channel, occupant.channel)) {
        season.set(number, asHolder(episode));
        placeExtraEpisode(season, number, occupant, 1);
        return;
    }
    placeExtraEpisode(season, number, episode, 0);
}

/**
 * The row as the coordinate's holder: its id comes from the coordinate, so
 * a `rowKey` it carried as another group's extra row (`mergeParts`) goes.
 */
function asHolder<T extends M3uArtworkBearing>(
    episode: M3uSeriesEpisode<T>
): M3uSeriesEpisode<T> {
    return episode.rowKey === undefined
        ? episode
        : { ...episode, rowKey: undefined };
}

/**
 * Which of two rows at one coordinate holds it, independent of row order.
 * The shorter name first: a variant added later ("… FHD", "… Part 2")
 * usually extends the episode's own name, so the episode keeps its id.
 * Equal lengths ("Part 1"/"Part 2") rank by the name itself, then the file
 * name, and only then by the playback key: URLs carry tokens a provider
 * rotates, and a tie broken on them would hand the coordinate's id — with
 * its watched mark and resume point — to the other row after a refresh.
 */
function holdsCoordinateBefore(
    candidate: M3uArtworkBearing & M3uPlaybackFields,
    holder: M3uArtworkBearing & M3uPlaybackFields
): boolean {
    const name = (row: M3uArtworkBearing) => (row.name ?? '').trim();
    const candidateName = name(candidate);
    const holderName = name(holder);
    if (candidateName.length !== holderName.length) {
        return candidateName.length < holderName.length;
    }
    if (candidateName !== holderName) return candidateName < holderName;
    const candidateFile = fileNameOf(candidate.url);
    const holderFile = fileNameOf(holder.url);
    if (candidateFile !== holderFile) return candidateFile < holderFile;
    return m3uPlaybackKey(candidate) < m3uPlaybackKey(holder);
}

/** Lists a further row of `number`, from the `from`th slot on. */
function placeExtraEpisode<T extends M3uArtworkBearing>(
    season: Season<T>,
    number: number,
    episode: M3uSeriesEpisode<T>,
    from: number
): void {
    // Further rows of one number sit at fractional keys, which keeps the
    // map ordered by episode without a second container.
    for (let extra = from; ; extra += 1) {
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
