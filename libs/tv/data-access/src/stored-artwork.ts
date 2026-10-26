import { resolveStalkerArtwork } from '@iptvnator/portal/stalker/client';
import { Media, Source } from '@iptvnator/tv/util';

/** Older saved Stalker items retain raw artwork even when their mapped poster is absent. */
export function storedMediaPoster(item: Media, source?: Source) {
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
