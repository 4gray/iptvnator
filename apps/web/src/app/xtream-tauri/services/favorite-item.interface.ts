export interface FavoriteItem {
    content_id: number;
    playlist_id: string;
    type: 'live' | 'vod' | 'series';
    title: string;
    stream_icon?: string;
    poster_url?: string;
    added_at?: string;
}
