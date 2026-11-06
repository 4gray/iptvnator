import {
    Kind,
    Media,
    ProviderClient,
    Source,
    seriesForEpisode,
} from '@iptvnator/tv/util';

/** Recover the exact provider parent; title queries narrow the lookup, never choose it. */
export async function findParentSeries(
    provider: ProviderClient,
    source: Source,
    episode: Media,
    signal: AbortSignal
): Promise<Media | undefined> {
    if (episode.sourceId !== source.id || episode.kind !== 'episode') return;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const saved = seriesForEpisode(episode);
    if (saved) return saved;
    let identity: unknown;
    try {
        identity = JSON.parse(episode.parentId ?? '');
    } catch {
        /* Legacy identity. */
    }
    const vod =
        Array.isArray(identity) &&
        identity[0] === source.id &&
        identity[1] === 'stalker' &&
        identity[2] === 'series' &&
        typeof identity[3] === 'string' &&
        identity[3].startsWith('movie:');
    const catalogs: Kind[] =
        vod && provider.capabilities.vodSeries
            ? ['movie']
            : provider.capabilities.vodSeries
              ? ['series', 'movie']
              : ['series'];
    let incomplete = false;
    for (const kind of catalogs) {
        const seen = new Set<string>();
        let complete = false;
        try {
            for (let page = 0; page < 20; page++) {
                if (signal.aborted)
                    throw new DOMException('Aborted', 'AbortError');
                const result = await provider.catalog(
                    kind,
                    '',
                    page,
                    episode.seriesTitle ?? '',
                    signal,
                    'provider'
                );
                if (signal.aborted)
                    throw new DOMException('Aborted', 'AbortError');
                const parent = result.items.find(
                    (item) =>
                        item.id === episode.parentId &&
                        item.sourceId === source.id &&
                        item.kind === 'series'
                );
                if (parent) return parent;
                const previous = seen.size;
                result.items.forEach((item) => seen.add(item.id));
                if (!result.items.length || seen.size >= result.total) {
                    complete = true;
                    break;
                }
                if (seen.size === previous) break;
            }
            if (!complete) incomplete = true;
        } catch (error) {
            if (signal.aborted) throw error;
            incomplete = true;
        }
    }
    if (incomplete) throw new Error('Series lookup is incomplete.');
}
