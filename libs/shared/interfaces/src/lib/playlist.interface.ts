import { PlaylistRecentlyViewedItem } from './playlist-recently-viewed.interface';
import { StalkerPortalItem } from './stalker-portal-item.interface';

/**
 * An interface that describe the possible states of the playlist update/refresh process
 */
export enum PlaylistUpdateState {
    UPDATED,
    IN_PROGRESS,
    NOT_UPDATED,
}

/**
 * Describes playlist interface
 */
export interface Playlist {
    _id: string;
    title: string;
    filename?: string;
    playlist?: any;
    importDate: string;
    lastUsage: string;
    /**
     * M3U playlists store channel URL strings (`string[]`).
     * Stalker portals store full item objects (`StalkerPortalItem[]`).
     */
    favorites?: (string | StalkerPortalItem)[];
    items?: unknown[];
    header?: unknown;
    count: number;
    url?: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
    filePath?: string;
    /** M3U-scoped EPG source URLs enabled for automatic import and lookup. */
    epgUrls?: string[];
    /** All M3U EPG source URLs detected from the playlist header. */
    detectedEpgUrls?: string[];
    /** Playlist-local EPG source URLs explicitly enabled by the user. */
    manualEpgUrls?: string[];
    /** Detected playlist EPG source URLs explicitly disabled by the user. */
    disabledEpgUrls?: string[];
    autoRefresh: boolean;
    updateDate?: number;
    updateState?: PlaylistUpdateState;
    position?: number;
    isTemporary?: boolean;
    serverUrl?: string;
    username?: string;
    password?: string;
    macAddress?: string;
    portalUrl?: string;
    recentlyViewed?: PlaylistRecentlyViewedItem[];
    /** Indicates if this is a full stalker portal URL (e.g., /stalker_portal/c) requiring handshake authentication */
    isFullStalkerPortal?: boolean;
    /**
     * The Xtream panel's own timezone, learned from `server_info` of the
     * account-info response and normalized by `resolveXtreamServerTimezone`
     * (an IANA name, or a clock-derived `UTC±HH:MM`). Persisted on the row so
     * every catch-up URL builder — the Live TV layout AND the Favorites /
     * Recent resolver, which reads the stored row — renders programme start
     * times in the clock the panel's `strtotime()` expects (issue #1562).
     */
    serverTimezone?: string;
    /** Session token for full stalker portal authentication - persisted for session */
    stalkerToken?: string;
    /**
     * Identity fingerprint the persisted `stalkerToken` was negotiated for.
     * Re-presenting a token minted for a DIFFERENT identity (the user edited
     * the MAC, serial or device ids) would pair a new identity with an old
     * session — the same class of bug the in-memory cache guards against, so
     * reuse is refused unless this still matches the playlist.
     */
    stalkerSessionIdentity?: string;
    /**
     * Watchdog cadence the portal advertised in `get_profile`, persisted
     * alongside the token: reusing a stored token skips the profile request
     * that carries these, so without persistence the keep-alive would fall
     * back to the 120 s default forever.
     */
    stalkerWatchdogTimeout?: number;
    /** Per-user watchdog jitter (seconds) from `get_profile`. */
    stalkerTimeslot?: number;
    /** Serial number for stalker portal - generated once and stored for consistency */
    stalkerSerialNumber?: string;
    /**
     * Optional device ID 1 for stalker portal. Absent means absent — nothing
     * generates one at request time. The import dialog can pre-fill a
     * MAC-derived value on request, but it is stored here as a literal string
     * from then on: the portal pins the first non-empty value to the MAC
     * permanently, so a value that silently followed a later MAC edit would be
     * refused as a device conflict.
     */
    stalkerDeviceId1?: string;
    /** Optional device ID 2 for stalker portal - same pinning rules as `stalkerDeviceId1`. */
    stalkerDeviceId2?: string;
    /** Optional signature 1 for stalker portal - required by some portals for device verification */
    stalkerSignature1?: string;
    /** Optional signature 2 for stalker portal - required by some portals for device verification */
    stalkerSignature2?: string;
    /** Account info from get_profile call */
    stalkerAccountInfo?: {
        login?: string;
        expireDate?: number;
        tariffPlanName?: string;
        status?: number;
    };
    /** Hidden M3U group titles for the groups view */
    hiddenGroupTitles?: string[];
}
