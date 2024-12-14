export interface XtreamItem {
    num: number;
    name: string;
    stream_type: 'live' | 'movie';
    stream_id: number;
    stream_icon: string;
    added: string;
    category_id: string;
    custom_sid: string;
    direct_source: string;
    rating_imdb?: string;
    xtream_id?: number;
    type?: 'movie' | 'series' | 'live';
}
