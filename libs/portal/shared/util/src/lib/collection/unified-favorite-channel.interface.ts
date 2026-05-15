/**
 * Unified interface for displaying live TV favorites from any source
 * (M3U playlists, Xtream Codes portals, Stalker portals) in one list.
 */
import { Channel } from '@iptvnator/shared/interfaces';

export type FavoriteSourceType = 'm3u' | 'xtream' | 'stalker';

export interface UnifiedFavoriteChannel {
    /**
     * Unique identifier within the global-favorites list.
     * Format: `{sourceType}::{playlistId}::{sourceItemId}`
     */
    uid: string;

    /** Display name of the channel */
    name: string;

    /** Logo / thumbnail URL */
    logo: string | null;

    /** Source type – determines how to resolve the stream URL */
    sourceType: FavoriteSourceType;

    /** ID of the parent playlist */
    playlistId: string;

    /** Human-readable playlist name */
    playlistName: string;

    /** Direct stream URL (M3U channels only) */
    streamUrl?: string;

    /** Full M3U channel metadata used by row context menu actions */
    m3uChannel?: Channel;

    /** Xtream numeric stream ID (Xtream channels only) */
    xtreamId?: number;

    /**
     * TVG id for M3U EPG lookup.
     * For Xtream channels, also used for short-EPG lookup.
     */
    tvgId?: string;

    /**
     * The stalker cmd value needed to resolve the stream URL.
     * Stored for Stalker favorites that are live channels.
     */
    stalkerCmd?: string;

    /** ISO timestamp when added to favorites */
    addedAt: string;

    /**
     * Display order within the unified list.
     * Lower values appear first. 0 = unset (sort by addedAt desc).
     */
    position: number;

    /** Xtream DB content id — used for REORDER IPC call */
    contentId?: number;

    /** Stalker portal credentials needed to resolve the live stream */
    stalkerPortalUrl?: string;
    stalkerMacAddress?: string;
}

/**
 * Build a stable UID string for a unified favorite channel.
 */
export function buildFavoriteUid(
    sourceType: FavoriteSourceType,
    playlistId: string,
    sourceItemId: string | number
): string {
    return `${sourceType}::${playlistId}::${sourceItemId}`;
}
