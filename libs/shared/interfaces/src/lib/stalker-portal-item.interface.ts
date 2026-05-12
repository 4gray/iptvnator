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
    /** Stalker content/category type such as 'itv', 'radio', 'vod', or 'series'. */
    category_id?: string | number;
    stream_type?: string;
    /** Radio marker returned by some Stalker portals for radio station lists. */
    radio?: boolean | number | string;
    is_series?: boolean | number | string;
    /** Embedded VOD-series episode numbers preserved for VOD favorites. */
    series?: unknown[];
    added_at?: string | number;
    cmd?: string;
}

/** Activity type normalised across all providers. */
export type PortalActivityType = 'live' | 'movie' | 'series';
