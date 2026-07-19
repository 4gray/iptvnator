import {
    StalkerContentItem,
    StalkerItvChannel,
    StalkerVodSource,
} from '../../models';

/**
 * Convert relative URLs to absolute URLs using the portal base URL
 * Handles screenshot_uri and cmd paths that come as relative from the server
 */
export function makeAbsoluteUrl(baseUrl: string, relativePath: string): string {
    if (!relativePath) return '';
    // Already absolute URL
    if (
        relativePath.startsWith('http://') ||
        relativePath.startsWith('https://')
    ) {
        return relativePath;
    }
    // Parse the base URL to get origin
    try {
        const url = new URL(baseUrl);
        // Ensure the relative path starts with /
        const path = relativePath.startsWith('/')
            ? relativePath
            : `/${relativePath}`;
        return `${url.origin}${path}`;
    } catch {
        return relativePath;
    }
}

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

export function toStalkerItvChannel(item: StalkerContentItem): StalkerItvChannel {
    return {
        ...item,
        id: item.id ?? item.stream_id ?? '',
        cmd: String(item.cmd ?? ''),
        name:
            typeof item.name === 'string' ? item.name : undefined,
        o_name:
            typeof item.o_name === 'string' ? item.o_name : undefined,
        logo:
            typeof item.logo === 'string' ? item.logo : undefined,
    };
}

