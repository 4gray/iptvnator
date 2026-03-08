/**
 * Represents a Stalker portal item stored in `Playlist.favorites` or
 * `Playlist.recentlyViewed` arrays.
 *
 * Stalker portals store favourites / recently-viewed as full objects
 * (unlike M3U playlists, which use a simple `string[]` of channel URLs).
 */
export interface StalkerPortalItem {
    id?: string | number;
    stream_id?: string | number;
    series_id?: string | number;
    movie_id?: string | number;
    title?: string;
    /** Original name */
    o_name?: string;
    name?: string;
    cover?: string;
    logo?: string;
    poster_url?: string;
    /** 'itv' | 'vod' | 'series' — Stalker content type */
    category_id?: string | number;
    stream_type?: string;
    is_series?: boolean | number | string;
    added_at?: string | number;
    cmd?: string;
}

/** Activity type normalised across all providers. */
export type PortalActivityType = 'live' | 'movie' | 'series';
