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
    source?: 'xtream' | 'stalker';
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
