import { firstNonBlankStalkerId } from '../../stalker-vod.utils';
import {
    StalkerContentItem,
    StalkerItvChannel,
    StalkerVodSource,
} from '../../models';

import { makeAbsoluteUrl } from '../../stalker-artwork.utils';
export { makeAbsoluteUrl } from '../../stalker-artwork.utils';

/**
 * Post-process stalker items to convert relative URLs to absolute
 */
export function processItemUrls<T extends StalkerVodSource>(
    item: T,
    portalUrl: string
): T {
    const processed = { ...item };

    // Convert screenshot_uri to absolute URL
    if (processed.screenshot_uri) {
        processed.screenshot_uri = makeAbsoluteUrl(
            portalUrl,
            processed.screenshot_uri
        );
    }

    return processed;
}

export function toStalkerContentItem(
    item: StalkerVodSource,
    portalUrl: string
): StalkerContentItem {
    const processed = processItemUrls(item, portalUrl);
    return {
        ...processed,
        cover: processed.screenshot_uri,
    };
}

/**
 * Local category filter for fully cached ITV channel lists.
 * Mirrors the portal-side `genre=<id>` filter of `get_ordered_list`.
 */
export function filterItvChannelsByGenre(
    channels: StalkerItvChannel[],
    categoryId: string | null | undefined
): StalkerItvChannel[] {
    if (!categoryId || categoryId === '*') {
        return channels;
    }

    const target = String(categoryId);
    return channels.filter(
        (channel) => String(channel.tv_genre_id ?? '') === target
    );
}

export function toStalkerItvChannel(
    item: StalkerContentItem
): StalkerItvChannel {
    return {
        ...item,
        // First NON-BLANK id: a blank `id` beside a valid `stream_id` must
        // not shadow it, or the row is unselectable and unplayable.
        id: firstNonBlankStalkerId(item.id, item.stream_id) ?? '',
        cmd: String(item.cmd ?? ''),
        name: typeof item.name === 'string' ? item.name : undefined,
        o_name: typeof item.o_name === 'string' ? item.o_name : undefined,
        logo: typeof item.logo === 'string' ? item.logo : undefined,
    };
}
