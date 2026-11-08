import type { XtreamSearchResultItem } from '@iptvnator/portal/xtream/data-access';

export interface AdditionalGlobalSearchResult {
    id: string;
    playlist_id: string;
    playlist_name: string;
    title: string;
    poster_url?: string;
    type: 'movie' | 'series';
    open(): void;
}

export type GlobalSearchCard =
    XtreamSearchResultItem | AdditionalGlobalSearchResult;

export function groupResultsByPlaylistId(items: readonly GlobalSearchCard[]) {
    const groups = new Map<
        string,
        {
            playlistId: string;
            playlistName: string;
            items: GlobalSearchCard[];
        }
    >();

    for (const item of items) {
        const playlistId = String(item.playlist_id ?? 'unknown');
        const group = groups.get(playlistId) ?? {
            playlistId,
            playlistName: String(item.playlist_name ?? playlistId),
            items: [],
        };
        group.items.push(item);
        groups.set(playlistId, group);
    }

    return [...groups.values()];
}
