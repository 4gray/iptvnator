import type { XtreamFavoriteCatalogStatus } from '@iptvnator/shared/interfaces';
export interface FavoriteItem {
    content_id: number | null;
    favorite_id?: number;
    catalog_status?: XtreamFavoriteCatalogStatus;
    playlist_id: string;
    type: 'live' | 'movie' | 'vod' | 'series';
    title: string;
    stream_icon?: string;
    poster_url?: string;
    added_at?: string;
    category_id: number;
    xtream_id: number;
}
