import { PlaybackPositionData } from './playback-position.interface';
import { M3uRecentlyViewedItem } from './playlist-recently-viewed.interface';
import { VpnProvider } from './settings.interface';
import { StalkerPortalItem } from './stalker-portal-item.interface';

export const PLAYLIST_BACKUP_KIND = 'iptvnator-playlist-backup';
export const PLAYLIST_BACKUP_VERSION = 1;

export type PlaylistBackupPortalType = 'm3u' | 'xtream' | 'stalker';
export type M3uBackupSourceKind = 'url' | 'file' | 'text';
export type XtreamBackupContentType = 'live' | 'movie' | 'series';
export type XtreamBackupCategoryType = 'live' | 'movies' | 'series';

export interface PlaylistBackupSettings {
    epgUrls: string[];
}

export interface PlaylistBackupBaseEntry {
    portalType: PlaylistBackupPortalType;
    exportedId: string;
    title: string;
    autoRefresh: boolean;
    position?: number;
    sourceVpn?: SourceVpnBackupConfig;
}

export interface SourceVpnBackupConfig {
    provider: VpnProvider;
    location?: string;
    autoConnectOnOpen?: boolean;
    autoConnectWhenDefault?: boolean;
}

export interface M3uPlaylistBackupEntry extends PlaylistBackupBaseEntry {
    portalType: 'm3u';
    source: {
        kind: M3uBackupSourceKind;
        rawM3u: string;
        url?: string;
        userAgent?: string;
        referrer?: string;
        origin?: string;
        filePathHint?: string;
    };
    userState: {
        favorites: string[];
        recentlyViewed: M3uRecentlyViewedItem[];
        hiddenGroupTitles: string[];
    };
}

export interface XtreamBackupHiddenCategory {
    categoryType: XtreamBackupCategoryType;
    xtreamId: number;
}

export interface XtreamBackupFavoriteItem {
    contentType: XtreamBackupContentType;
    xtreamId: number;
    addedAt?: string;
    position?: number | null;
}

export interface XtreamBackupRecentlyViewedItem {
    contentType: XtreamBackupContentType;
    xtreamId: number;
    viewedAt: string;
}

export interface XtreamBackupUserState {
    hiddenCategories: XtreamBackupHiddenCategory[];
    favorites: XtreamBackupFavoriteItem[];
    recentlyViewed: XtreamBackupRecentlyViewedItem[];
    playbackPositions: PlaybackPositionData[];
}

export interface XtreamPlaylistBackupEntry extends PlaylistBackupBaseEntry {
    portalType: 'xtream';
    connection: {
        serverUrl: string;
        username: string;
        password?: string;
    };
    userState: XtreamBackupUserState;
}

export interface StalkerPlaylistBackupEntry extends PlaylistBackupBaseEntry {
    portalType: 'stalker';
    connection: {
        portalUrl: string;
        macAddress: string;
        isFullStalkerPortal?: boolean;
        username?: string;
        password?: string;
        userAgent?: string;
        referrer?: string;
        origin?: string;
        stalkerSerialNumber?: string;
        stalkerDeviceId1?: string;
        stalkerDeviceId2?: string;
        stalkerSignature1?: string;
        stalkerSignature2?: string;
    };
    userState: {
        favorites: StalkerPortalItem[];
        recentlyViewed: StalkerPortalItem[];
    };
}

export type PlaylistBackupEntry =
    | M3uPlaylistBackupEntry
    | XtreamPlaylistBackupEntry
    | StalkerPlaylistBackupEntry;

export interface PlaylistBackupManifestV1 {
    kind: typeof PLAYLIST_BACKUP_KIND;
    version: typeof PLAYLIST_BACKUP_VERSION;
    exportedAt: string;
    includeSecrets: boolean;
    settings?: PlaylistBackupSettings;
    playlists: PlaylistBackupEntry[];
}
