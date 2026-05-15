import { InjectionToken } from '@angular/core';

export interface XtreamCollectionDataSourceItem {
    readonly id?: number;
    readonly category_id?: number | string;
    readonly title?: string;
    readonly name?: string;
    readonly rating?: string;
    readonly added?: string;
    readonly added_at?: string;
    readonly viewed_at?: string;
    readonly poster_url?: string;
    readonly backdrop_url?: string | null;
    readonly xtream_id?: number;
    readonly type?: string;
    readonly stream_type?: 'live' | 'movie';
    readonly stream_id?: number;
    readonly stream_icon?: string;
    readonly stream_display_name?: string;
    readonly cover?: string;
    readonly series_id?: number;
}

export interface XtreamCollectionDataSource {
    getFavorites(playlistId: string): Promise<XtreamCollectionDataSourceItem[]>;
    addFavorite(
        contentId: number,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void>;
    removeFavorite(contentId: number, playlistId: string): Promise<void>;
    getRecentItems(
        playlistId: string
    ): Promise<XtreamCollectionDataSourceItem[]>;
    addRecentItem(
        contentId: number,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void>;
    removeRecentItem(contentId: number, playlistId: string): Promise<void>;
    clearRecentItems(playlistId: string): Promise<void>;
}

const noopXtreamCollectionDataSource: XtreamCollectionDataSource = {
    getFavorites: async () => [],
    addFavorite: async () => undefined,
    removeFavorite: async () => undefined,
    getRecentItems: async () => [],
    addRecentItem: async () => undefined,
    removeRecentItem: async () => undefined,
    clearRecentItems: async () => undefined,
};

export const XTREAM_COLLECTION_DATA_SOURCE =
    new InjectionToken<XtreamCollectionDataSource>(
        'XtreamCollectionDataSource',
        {
            providedIn: 'root',
            factory: () => noopXtreamCollectionDataSource,
        }
    );
