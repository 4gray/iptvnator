import { StalkerPortalItem } from './stalker-portal-item.interface';

export interface M3uRecentlyViewedItem {
    source: 'm3u';
    id: string;
    url: string;
    title: string;
    channel_id?: string;
    poster_url?: string;
    tvg_id?: string;
    tvg_name?: string;
    group_title?: string;
    category_id: 'live';
    added_at: string | number;
}

export type PlaylistRecentlyViewedItem =
    | M3uRecentlyViewedItem
    | StalkerPortalItem;

export function isM3uRecentlyViewedItem(
    item: unknown
): item is M3uRecentlyViewedItem {
    if (!item || typeof item !== 'object') {
        return false;
    }

    const candidate = item as Record<string, unknown>;
    return (
        candidate['source'] === 'm3u' &&
        typeof candidate['url'] === 'string' &&
        candidate['url'].trim().length > 0
    );
}
