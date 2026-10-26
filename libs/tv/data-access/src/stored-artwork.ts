import { resolveStalkerArtwork } from '@iptvnator/portal/stalker/client';
import { Media, Source, seriesForEpisode } from '@iptvnator/tv/util';

/** Prefer exact current/saved series covers; retain raw Stalker artwork for older items. */
export function storedMediaPoster(
    item: Media,
    source?: Source,
    parents: Media[] = []
): string | undefined {
    const parent = seriesForEpisode(item, parents);
    if (parent) {
        const saved = seriesForEpisode(item);
        return (
            storedMediaPoster(parent, source) ||
            (saved && saved !== parent
                ? storedMediaPoster(saved, source)
                : undefined)
        );
    }
    if (item.poster) return item.poster;
    if (source?.id !== item.sourceId || source.provider !== 'stalker')
        return undefined;
    return resolveStalkerArtwork(
        source.endpoint ?? source.url,
        item.raw.cover,
        item.raw.screenshot_uri,
        item.raw.logo,
        item.raw.poster_url
    );
}
