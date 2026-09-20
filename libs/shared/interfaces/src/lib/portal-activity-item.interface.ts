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
     * Wide backdrop URL (typically 16:9), recorded when the user first views
     * the detail page — for xtream on the `content` row, for stalker inside
     * the stored playlist entry (`info.tmdb_backdrop`), since stalker items
     * never reach the `content` table. Absent for items whose detail page has
     * never been opened, and for stalker items opened without TMDB
     * enrichment. Dashboards should fall back to a blurred `poster_url` when
     * undefined.
     */
    backdrop_url?: string;
    /**
     * TMDB identity a detail view recorded on this item's `content` row, so a
     * reader can repeat the lookup that view performed instead of rebuilding a
     * weaker one from `title` alone. Xtream only, and only once the item's
     * detail page has been opened at least once — everything reading these
     * must keep working without them. Stalker carries the same facts inside
     * `stalker_item` instead (`extractStalkerItemTmdbHints`), and M3U rows
     * never reach the `content` table at all.
     */
    tmdb_id?: number;
    /** The year the PROVIDER stated, never one read out of the title */
    release_year?: number;
    original_title?: string;
    source?: 'xtream' | 'stalker' | 'm3u';
    /** Original stalker item for navigation state; undefined for xtream. */
    stalker_item?: StalkerPortalItem;
    /**
     * How the item's watch progress is tracked, when that differs from the
     * catalog section `type` routes it to. A Stalker embedded-VOD (`series[]`)
     * or lazy Ministra `is_series` row lives in the VOD catalog and must keep
     * routing there (`type: 'movie'`), yet its progress is a set of EPISODE
     * positions keyed by the parent id. Readers that decide between a movie
     * position and a series position go through
     * `resolvePortalActivityWatchKind`, never `type` alone. Absent means
     * "same as `type`".
     */
    watch_kind?: PortalActivityWatchKind;
}

/** Progress model of a VOD activity item: one position, or per-episode positions. */
export type PortalActivityWatchKind = 'movie' | 'series';

/**
 * The progress model a dashboard/collection reader should use for an item:
 * the explicit `watch_kind` when a mapper recorded one, else the catalog
 * `type`. Live items have no progress and resolve to `null`.
 */
export function resolvePortalActivityWatchKind(
    item: Pick<PortalActivityItem, 'type' | 'watch_kind'>
): PortalActivityWatchKind | null {
    if (item.watch_kind === 'movie' || item.watch_kind === 'series') {
        return item.watch_kind;
    }
    if (item.type === 'movie' || item.type === 'series') {
        return item.type;
    }
    return null;
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
