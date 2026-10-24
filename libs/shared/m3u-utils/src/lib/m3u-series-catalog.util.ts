import type { Channel } from '@iptvnator/shared/interfaces';

export interface M3uEpisodeEntry {
    readonly channel: Channel;
    readonly episode: number;
}
export interface M3uSeason {
    readonly number: number;
    readonly episodes: M3uEpisodeEntry[];
}
export interface M3uSeries {
    readonly key: string;
    readonly title: string;
    readonly seasons: M3uSeason[];
    readonly count: number;
}

/** Only unambiguous episode markers become season entries. */
const CODE = /(?:^|[^\p{L}\p{N}])s(\d{1,2})[\s._-]*e(\d{1,3})(?=$|[^\p{L}\p{N}])/iu;
const CROSS = /(?:^|[^\p{L}\p{N}])(\d{1,2})x(\d{2,3})(?=$|[^\p{L}\p{N}])/iu;
const WORDS = /(?:^|[^\p{L}\p{N}])(?:season|sezon)[\s._:-]*(\d{1,2})[\s._:-]*(?:episode|ep|bölüm|bolum)[\s._:-]*(\d{1,3})(?=$|[^\p{L}\p{N}])/iu;
const EPISODE_ONLY = /(?:^|[^\p{L}\p{N}])(?:episode|ep|bölüm|bolum)[\s._:-]*(\d{1,3})(?=$|[^\p{L}\p{N}])/iu;

function stripMarker(name: string, match: RegExpMatchArray): string {
    // Regexp consumes a possible separator before the marker; keep only title
    // text, not quality/episode descriptors.
    const start = (match.index ?? 0) + (match[0].length - match[0].trimStart().length);
    const before = name.slice(0, start).replace(/[\s._-]+$/u, '');
    const after = name.slice((match.index ?? 0) + match[0].length)
        .replace(/^[\s._-]+/u, '')
        .replace(/^(?:hd|fhd|uhd|4k|1080p|720p)(?:$|[\s._\-])/iu, '')
        .trim();
    return (before || after || name).trim();
}

export function parseM3uEpisode(
    channel: Pick<Channel, 'name'>
): { title: string; season: number; episode: number } | null {
    const name = channel.name?.trim() ?? '';
    if (!name) return null;
    const match = name.match(CODE) ?? name.match(CROSS) ?? name.match(WORDS);
    if (match) {
        const season = Number(match[1]);
        const episode = Number(match[2]);
        if (episode > 0) return { title: stripMarker(name, match), season, episode };
    }
    const withoutSeason = name.match(EPISODE_ONLY);
    if (!withoutSeason) return null;
    const episode = Number(withoutSeason[1]);
    return episode > 0
        ? { title: stripMarker(name, withoutSeason), season: 0, episode }
        : null;
}

/**
 * Group references, never rewrite source entries. Unknown names are kept as
 * independent unorganized rows; they remain available and playable.
 * O(n) inventory pass, one final sort per distinct series/season.
 */
export function buildM3uSeriesCatalog(channels: readonly Channel[]): {
    series: M3uSeries[];
    unorganized: Channel[];
} {
    const grouped = new Map<string, {
        title: string;
        seasons: Map<number, M3uEpisodeEntry[]>;
        count: number;
    }>();
    const unorganized: Channel[] = [];
    for (const channel of channels) {
        const parsed = parseM3uEpisode(channel);
        if (!parsed?.title || parsed.title === channel.name) {
            unorganized.push(channel);
            continue;
        }
        const key = parsed.title.normalize('NFKC').toLocaleLowerCase('tr-TR');
        let item = grouped.get(key);
        if (!item) {
            item = { title: parsed.title, seasons: new Map(), count: 0 };
            grouped.set(key, item);
        }
        const episodes = item.seasons.get(parsed.season) ?? [];
        episodes.push({ channel, episode: parsed.episode });
        item.seasons.set(parsed.season, episodes);
        item.count++;
    }
    const series = Array.from(grouped, ([key, item]): M3uSeries => ({
        key,
        title: item.title,
        count: item.count,
        seasons: Array.from(item.seasons, ([number, episodes]) => ({
            number,
            episodes: episodes.sort((a, b) => a.episode - b.episode),
        })).sort((a, b) => a.number - b.number),
    })).sort((a, b) => a.title.localeCompare(b.title, 'tr'));
    return { series, unorganized };
}
