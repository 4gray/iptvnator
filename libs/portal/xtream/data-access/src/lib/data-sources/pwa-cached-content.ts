/** Provider catalog shape retained by the session cache before collection mapping. */
export interface XtreamCachedContentItem {
    readonly added?: string;
    readonly backdrop_url?: string | null;
    readonly category_id?: string | number;
    readonly cover?: string;
    readonly cover_big?: string;
    readonly id?: number | string;
    readonly last_modified?: string;
    readonly movie_image?: string;
    readonly name?: string;
    readonly poster?: string;
    readonly poster_url?: string;
    readonly rating?: string | number;
    readonly series_id?: number;
    readonly stream_display_name?: string;
    readonly stream_id?: number;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly type?: string;
    readonly viewed_at?: string;
    readonly xtream_id?: number | string;
}
