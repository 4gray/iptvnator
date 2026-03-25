/**
 * Unified interface for displaying favorites or recently-viewed items
 * from any source (M3U, Xtream, Stalker) in one list.
 *
 * Extends the previous live-only UnifiedFavoriteChannel to cover
 * all content types: live TV, movies, and series.
 */
export type CollectionSourceType = 'm3u' | 'xtream' | 'stalker';
export type CollectionContentType = 'live' | 'movie' | 'series';

export interface UnifiedCollectionItem {
    /** Unique identifier: `{sourceType}::{playlistId}::{sourceItemId}` */
    uid: string;

    /** Display name */
    name: string;

    /** Content type — determines which tab / layout to use */
    contentType: CollectionContentType;

    /** Source type — determines how to resolve playback */
    sourceType: CollectionSourceType;

    /** Parent playlist ID */
    playlistId: string;

    /** Human-readable playlist name */
    playlistName: string;

    /** Logo / thumbnail URL (live channels) */
    logo?: string | null;

    /** Poster image URL (movies / series) */
    posterUrl?: string | null;

    /** Direct stream URL (M3U channels only) */
    streamUrl?: string;

    /** TVG id for EPG lookup (M3U / Xtream live) */
    tvgId?: string;

    /** Xtream numeric stream ID */
    xtreamId?: number;

    /** Xtream DB content id — used for reorder / remove IPC */
    contentId?: number;

    /** Stalker cmd for stream resolution */
    stalkerCmd?: string;
    stalkerPortalUrl?: string;
    stalkerMacAddress?: string;

    /** Category ID for VOD/Series navigation */
    categoryId?: string | number;

    /** Content rating (VOD) */
    rating?: string;

    /** ISO timestamp when added to favorites */
    addedAt?: string;

    /** Display order (favorites) */
    position?: number;

    /** ISO timestamp when viewed (recently-viewed) */
    viewedAt?: string;

    /** Original stalker item for detail navigation */
    stalkerItem?: unknown;
}

/**
 * Build a stable UID string for a unified collection item.
 */
export function buildCollectionUid(
    sourceType: CollectionSourceType,
    playlistId: string,
    sourceItemId: string | number
): string {
    return `${sourceType}::${playlistId}::${sourceItemId}`;
}
