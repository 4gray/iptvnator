import { M3uArtworkBearing, M3uSeriesEpisode } from './m3u-series-model';

/**
 * Where an episode row goes inside its season.
 *
 * One rule runs through both functions: a row with its own URL is never
 * hidden behind another row. The split has taken every episode row out of
 * the channel list, so a row parked where nothing reads it plays nowhere.
 * Only the same URL again — the same row twice — is parked.
 */

type Season<T> = Map<number, M3uSeriesEpisode<T>>;

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
        if (held.channel.url === episode.channel.url) {
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
        if (held.channel.url === episode.channel.url) {
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
