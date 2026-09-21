import { Channel, XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { M3uSeries, M3uSeriesEpisode } from '@iptvnator/shared/m3u-utils';

/**
 * Converts an aggregated M3U series into the shape the shared season
 * components already render.
 *
 * ## Why the conversion lives here and not in the aggregator
 *
 * `XtreamSerieEpisode` is a UI contract of those components, not a property
 * of an M3U playlist. Keeping it out of the aggregator lets that module
 * import contracts only, and keeps this translation next to its single
 * consumer — the same reasoning that put Stalker's episode adapter in its
 * own feature library rather than in a shared one.
 *
 * ## What makes it playable with no new plumbing
 *
 * `direct_source` carries the row's own URL. The player chain already
 * prefers it when present, so an M3U episode plays through exactly the path
 * a portal episode does — no second playback route, no special-casing.
 */

/** Season keys are strings because the shared component sorts them as such. */
export type M3uSeasonRecord = Record<string, XtreamSerieEpisode[]>;

export function toXtreamEpisode(
    episode: M3uSeriesEpisode<Channel>
): XtreamSerieEpisode {
    const channel = episode.channel;

    return {
        // The shared component reads `Number(episode.id)` everywhere, so the
        // aggregator's stable numeric id has to survive the round trip as a
        // string that parses back to itself.
        id: String(episode.id),
        episode_num: episode.episodeNumber,
        title: episodeTitle(episode),
        container_extension: containerExtension(channel.url),
        info: {
            movie_image: channel.tvg?.logo || undefined,
        },
        custom_sid: '',
        added: '',
        season: episode.seasonNumber,
        direct_source: channel.url,
    };
}

export function toSeasonRecord(series: M3uSeries<Channel>): M3uSeasonRecord {
    const seasons: M3uSeasonRecord = {};

    for (const [number, episodes] of series.seasons) {
        seasons[String(number)] = episodes.map(toXtreamEpisode);
    }

    return seasons;
}

/**
 * An episode shows the title the provider wrote after the marker when there
 * is one, and its number otherwise. "Episode 5" reads better in a grid than
 * a repeat of the series name, which is what the raw row would give.
 */
function episodeTitle(episode: M3uSeriesEpisode<Channel>): string {
    return episode.title ?? `E${episode.episodeNumber}`;
}

function containerExtension(url: string): string {
    const path = url.split(/[?#]/)[0];
    const lastDot = path.lastIndexOf('.');
    const lastSlash = path.lastIndexOf('/');
    if (lastDot === -1 || lastDot < lastSlash) {
        return '';
    }

    return path.slice(lastDot + 1).toLowerCase();
}
