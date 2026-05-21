import {
    PortalActivityType,
    StalkerPortalItem,
} from './stalker-portal-item.interface';

/**
 * Base interface for cross-provider activity items (recently viewed,
 * favorites) displayed on the dashboard and in global lists.
 */
export interface PortalActivityItem {
    id: string | number;
    title: string;
    type: PortalActivityType;
    playlist_id: string;
    playlist_name?: string;
    category_id: string | number;
    xtream_id: string | number;
    poster_url?: string;
    /**
     * Preferred XMLTV lookup key for live EPG enrichment. For M3U channels this
     * follows the app-wide tvg.id -> tvg.name -> display name fallback chain.
     */
    epg_lookup_key?: string;
    /**
     * Wide backdrop URL (typically 16:9), persisted when the user first views
     * the detail page. Absent for stalker and for items that have never had
     * their detail page opened. Dashboards should fall back to a blurred
     * `poster_url` when undefined.
     */
    backdrop_url?: string;
    source?: 'xtream' | 'stalker' | 'm3u';
    /** Original stalker item for navigation state; undefined for xtream. */
    stalker_item?: StalkerPortalItem;
}

/** A recently-viewed item with a `viewed_at` timestamp. */
export interface PortalRecentItem extends PortalActivityItem {
    viewed_at: string;
}

/** A favorite item with an `added_at` timestamp. */
export interface PortalFavoriteItem extends PortalActivityItem {
    added_at: string;
}

/** A recently-added catalog item with an `added_at` timestamp. */
export interface PortalAddedItem extends PortalActivityItem {
    added_at: string;
}
