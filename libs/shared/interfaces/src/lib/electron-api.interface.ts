import {
    EmbeddedMpvBounds,
    EmbeddedMpvRecordingStartOptions,
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
} from './embedded-mpv-session.interface';
import { EpgChannelMetadata } from './epg-channel-metadata.model';
import { EpgProgram } from './epg-program.model';
import { ExternalPlayerSession } from './external-player-session.interface';
import {
    GlobalSearchPaginationOptions,
    GlobalSearchResult,
    GlobalSearchResultSource,
} from './global-search-result.interface';
import { M3uFavoriteChannel } from './m3u-favorite-channel.interface';
import { PlaybackPositionData } from './playback-position.interface';
import {
    XtreamBackupFavoriteItem,
    XtreamBackupHiddenCategory,
    XtreamBackupRecentlyViewedItem,
} from './playlist-backup.interface';
import {
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
} from './playlist-refresh.interface';
import { Playlist } from './playlist.interface';
import {
    PlayerContentInfo,
    ResolvedPortalPlayback,
} from './portal-playback.interface';
import { PortalDebugEvent } from './portal-debug.interface';
import { Settings } from './settings.interface';
import { XtreamCategory } from './xtream-category.interface';

export const ELECTRON_BRIDGE_CONTENT_TYPES = {
    Episode: 'episode',
    Live: 'live',
    Movie: 'movie',
    Series: 'series',
    Vod: 'vod',
} as const;

export type ElectronBridgeContentType =
    (typeof ELECTRON_BRIDGE_CONTENT_TYPES)[keyof typeof ELECTRON_BRIDGE_CONTENT_TYPES];

export type ElectronBridgePortalContentType =
    | typeof ELECTRON_BRIDGE_CONTENT_TYPES.Live
    | typeof ELECTRON_BRIDGE_CONTENT_TYPES.Movie
    | typeof ELECTRON_BRIDGE_CONTENT_TYPES.Series;

export type ElectronBridgePlaybackContentType =
    | typeof ELECTRON_BRIDGE_CONTENT_TYPES.Vod
    | typeof ELECTRON_BRIDGE_CONTENT_TYPES.Episode;

export const ELECTRON_BRIDGE_PLAYLIST_TYPES = {
    M3uFile: 'm3u-file',
    M3uText: 'm3u-text',
    M3uUrl: 'm3u-url',
    Stalker: 'stalker',
    Xtream: 'xtream',
} as const;

export type ElectronBridgePlaylistType =
    (typeof ELECTRON_BRIDGE_PLAYLIST_TYPES)[keyof typeof ELECTRON_BRIDGE_PLAYLIST_TYPES];

export const ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES = {
    Complete: 'complete',
    Error: 'error',
    Loading: 'loading',
    Queued: 'queued',
} as const;

export type ElectronBridgeEpgProgressStatus =
    (typeof ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES)[keyof typeof ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES];

export const ELECTRON_BRIDGE_SECURITY_ERROR_CODES = {
    EpgPrivateNetworkBlocked: 'epg-private-network-blocked',
    InvalidTlsCertificate: 'invalid-tls-certificate',
} as const;

export type ElectronBridgeSecurityErrorCode =
    (typeof ELECTRON_BRIDGE_SECURITY_ERROR_CODES)[keyof typeof ELECTRON_BRIDGE_SECURITY_ERROR_CODES];

export const ELECTRON_BRIDGE_DB_OPERATION_STATUSES = {
    Cancelled: 'cancelled',
    Completed: 'completed',
    Error: 'error',
    Progress: 'progress',
    Started: 'started',
} as const;

export type ElectronBridgeDbOperationStatus =
    (typeof ELECTRON_BRIDGE_DB_OPERATION_STATUSES)[keyof typeof ELECTRON_BRIDGE_DB_OPERATION_STATUSES];

export const ELECTRON_BRIDGE_REMOTE_CONTROL_COMMAND_TYPES = {
    ChannelSelectNumber: 'channel-select-number',
    VolumeDown: 'volume-down',
    VolumeToggleMute: 'volume-toggle-mute',
    VolumeUp: 'volume-up',
} as const;

export type ElectronBridgeRemoteControlCommandType =
    (typeof ELECTRON_BRIDGE_REMOTE_CONTROL_COMMAND_TYPES)[keyof typeof ELECTRON_BRIDGE_REMOTE_CONTROL_COMMAND_TYPES];

export const ELECTRON_BRIDGE_REMOTE_PORTALS = {
    M3u: 'm3u',
    Stalker: 'stalker',
    Unknown: 'unknown',
    Xtream: 'xtream',
} as const;

export type ElectronBridgeRemotePortal =
    (typeof ELECTRON_BRIDGE_REMOTE_PORTALS)[keyof typeof ELECTRON_BRIDGE_REMOTE_PORTALS];

export const ELECTRON_BRIDGE_DOWNLOAD_STATUSES = {
    Canceled: 'canceled',
    Completed: 'completed',
    Downloading: 'downloading',
    Failed: 'failed',
    Queued: 'queued',
} as const;

export type ElectronBridgeDownloadStatus =
    (typeof ELECTRON_BRIDGE_DOWNLOAD_STATUSES)[keyof typeof ELECTRON_BRIDGE_DOWNLOAD_STATUSES];

export const ELECTRON_BRIDGE_GLOBAL_RECENTLY_ADDED_KINDS = {
    All: 'all',
    Series: 'series',
    Vod: 'vod',
} as const;

export type ElectronBridgeGlobalRecentlyAddedKind =
    (typeof ELECTRON_BRIDGE_GLOBAL_RECENTLY_ADDED_KINDS)[keyof typeof ELECTRON_BRIDGE_GLOBAL_RECENTLY_ADDED_KINDS];

export interface ElectronBridgeResult {
    success: boolean;
}

export interface ElectronBridgeErrorResult extends ElectronBridgeResult {
    error?: string;
}

export interface ElectronBridgeCountResult extends ElectronBridgeResult {
    count: number;
}

export interface ElectronBridgeDialogFilter {
    name: string;
    extensions: string[];
}

export interface ElectronBridgeWindowState {
    isMaximized: boolean;
    isFullScreen: boolean;
}

export interface ElectronBridgeAiSettings {
    aiProvider: string;
    aiModelName: string;
    aiApiKey: string;
}

export interface ElectronBridgeStalkerRequestPayload {
    url: string;
    macAddress: string;
    params: Record<string, string>;
    token?: string;
    serialNumber?: string;
    requestId?: string;
}

export interface ElectronBridgeXtreamRequestPayload {
    url: string;
    params: Record<string, string>;
    requestId?: string;
    sessionId?: string;
    suppressErrorLog?: boolean;
}

export interface ElectronBridgeXtreamResponse {
    payload: unknown;
    action: string;
}

export interface ElectronBridgeXtreamCancelResult extends ElectronBridgeResult {
    cancelled: number;
}

export interface ElectronBridgeXtreamProbeResult {
    status: number;
    url: string;
}

export interface ElectronBridgeEpgFetchResult extends ElectronBridgeResult {
    message?: string;
    skipped?: string[];
}

export interface ElectronBridgeTrustOptions {
    trustedPrivateNetworkEpgUrls?: string[];
    trustedInsecureTlsHosts?: string[];
}

export interface ElectronBridgeEpgFreshnessResult {
    staleUrls: string[];
    freshUrls: string[];
}

export interface ElectronBridgeEpgLookupOptions {
    sourceUrls?: string[];
}

export interface ElectronBridgeEpgProgressStats {
    totalChannels: number;
    totalPrograms: number;
}

export interface ElectronBridgeEpgProgress {
    url: string;
    status: ElectronBridgeEpgProgressStatus;
    stats?: ElectronBridgeEpgProgressStats;
    error?: string;
    errorCode?: ElectronBridgeSecurityErrorCode;
    errorHost?: string;
    queuePosition?: number;
}

export interface ElectronBridgeEpgChannelSummary {
    id: string;
    displayName: string;
}

export interface ElectronBridgeEpgChannelListResult {
    channels: ElectronBridgeEpgChannelSummary[];
    /** Always empty for this endpoint; retained for wire-format compatibility. */
    programs: [];
}

export interface ElectronBridgeEpgChannelWithPrograms extends ElectronBridgeEpgChannelSummary {
    iconUrl: string | null;
    programs: EpgProgram[];
}

export interface ElectronBridgeDbOperationEvent {
    operationId?: string;
    operation: string;
    playlistId?: string;
    status: ElectronBridgeDbOperationStatus;
    phase?: string;
    current?: number;
    total?: number;
    increment?: number;
    error?: string;
}

export interface ElectronBridgePlaylistInput {
    id?: string;
    _id?: string;
    name?: string;
    title?: string;
    serverUrl?: string;
    username?: string;
    password?: string;
    macAddress?: string;
    url?: string;
    type?: ElectronBridgePlaylistType | string;
    lastUpdated?: string;
}

export interface ElectronBridgePlaylistRow {
    id: string;
    name: string;
    serverUrl: string;
    username: string;
    password: string;
    type: string;
    macAddress?: string;
    url?: string;
    lastUpdated?: string;
}

export type ElectronBridgePlaylistUpsertInput =
    | Playlist
    | ElectronBridgePlaylistInput;

export interface ElectronBridgeCategoryRow {
    id: number;
    name: string;
    playlist_id: string;
    type: 'movies' | 'live' | 'series';
    xtream_id: number;
    hidden: boolean;
}

export interface ElectronBridgeXtreamContent {
    id: number;
    category_id: number;
    title: string;
    rating: string;
    added: string;
    poster_url: string;
    backdrop_url?: string | null;
    epg_channel_id?: string | null;
    tv_archive?: number | null;
    tv_archive_duration?: number | null;
    direct_source?: string | null;
    xtream_id: number;
    type: string;
    added_at?: string;
    viewed_at?: string;
    position?: number | null;
}

export type ElectronBridgeXtreamContentStream =
    | {
          category_id: string | number;
          rating?: string | number;
          rating_imdb?: string;
          last_modified?: string;
          added?: string;
          stream_icon?: string;
          poster?: string;
          cover?: string;
          name?: string;
          title?: string;
          epg_channel_id?: string;
          tv_archive?: string | number;
          tv_archive_duration?: string | number;
          direct_source?: string;
          series_id?: string | number;
          stream_id?: string | number;
      }
    | Record<string, unknown>;

export type ElectronBridgeGlobalSearchResult = GlobalSearchResult;

export interface ElectronBridgeGlobalRecentItem extends ElectronBridgeXtreamContent {
    playlist_id: string;
    playlist_name: string;
    viewed_at: string;
}

export interface ElectronBridgeGlobalFavoriteItem extends ElectronBridgeXtreamContent {
    playlist_id: string;
    playlist_name: string;
    added_at: string;
}

export interface ElectronBridgeGlobalRecentlyAddedItem extends ElectronBridgeXtreamContent {
    playlist_id: string;
    playlist_name: string;
    added_at: string;
}

export interface ElectronBridgeFavoriteReorderUpdate {
    content_id: number;
    position: number;
}

export interface ElectronBridgeRecentItemsBatchItem {
    contentId: number;
    playlistId: string;
}

export interface ElectronBridgeRemoteControlCommand {
    type: ElectronBridgeRemoteControlCommandType;
    number?: number;
}

export interface ElectronBridgeRemoteControlStatus {
    portal: ElectronBridgeRemotePortal;
    isLiveView: boolean;
    channelName?: string;
    channelNumber?: number;
    epgTitle?: string;
    epgStart?: string;
    epgEnd?: string;
    supportsVolume?: boolean;
    volume?: number;
    muted?: boolean;
}

export interface ElectronBridgePlayerError {
    player: string;
    error: string;
    originalError: string;
}

export interface ElectronBridgePlaybackPositionInput extends Omit<
    PlaybackPositionData,
    'playlistId' | 'updatedAt'
> {
    playlistType?: ElectronBridgePlaylistType;
}

export interface ElectronBridgeDownloadHeaders {
    userAgent?: string;
    referer?: string;
    origin?: string;
}

export interface ElectronBridgeDownloadStartPayload {
    playlistId: string;
    xtreamId: number;
    contentType: ElectronBridgePlaybackContentType;
    title: string;
    url: string;
    posterUrl?: string;
    downloadFolder: string;
    headers?: ElectronBridgeDownloadHeaders;
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    playlistName?: string;
    playlistType?: ElectronBridgePlaylistType;
    serverUrl?: string;
    portalUrl?: string;
    macAddress?: string;
}

export interface ElectronBridgeDownloadStartResult extends ElectronBridgeErrorResult {
    id?: number;
}

export interface ElectronDownloadItem {
    id: number;
    playlistId: string;
    xtreamId: number;
    contentType: ElectronBridgePlaybackContentType;
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    title: string;
    url: string;
    fileName?: string;
    filePath?: string;
    posterUrl?: string;
    status: ElectronBridgeDownloadStatus;
    bytesDownloaded?: number;
    totalBytes?: number;
    errorMessage?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface ElectronBridgeApi {
    onPortalDebugEvent?: (
        callback: (data: PortalDebugEvent) => void
    ) => () => void;
    onPlaylistRefreshEvent?: (
        callback: (data: PlaylistRefreshEvent) => void
    ) => () => void;
    getAppVersion: () => Promise<string>;
    platform: string;
    minimizeWindow: () => Promise<void>;
    toggleMaximizeWindow: () => Promise<ElectronBridgeWindowState>;
    closeWindow: () => Promise<void>;
    getWindowState: () => Promise<ElectronBridgeWindowState>;
    onWindowStateChange: (
        callback: (state: ElectronBridgeWindowState) => void
    ) => () => void;
    fetchPlaylistByUrl: (
        url: string,
        title?: string,
        options?: ElectronBridgeTrustOptions
    ) => Promise<Playlist>;
    updatePlaylistFromFilePath: (
        filePath: string,
        title: string
    ) => Promise<Playlist>;
    openPlaylistFromFile: () => Promise<Playlist | null>;
    getPathForFile: (file: File) => string;
    saveFileDialog: (
        defaultPath: string,
        filters?: ElectronBridgeDialogFilter[]
    ) => Promise<string | null>;
    writeFile: (
        filePath: string,
        content: string
    ) => Promise<ElectronBridgeResult>;
    setUserAgent: (
        userAgent?: string | null,
        referer?: string | null,
        scopeUrl?: string | null
    ) => Promise<boolean>;
    openInMpv: (
        url: string,
        title: string,
        thumbnail: string,
        userAgent: string | undefined,
        referer?: string,
        origin?: string,
        contentInfo?: PlayerContentInfo,
        startTime?: number,
        headers?: Record<string, string>
    ) => Promise<ExternalPlayerSession>;
    openInVlc: (
        url: string,
        title: string,
        thumbnail: string,
        userAgent: string | undefined,
        referer?: string,
        origin?: string,
        contentInfo?: PlayerContentInfo,
        startTime?: number,
        headers?: Record<string, string>
    ) => Promise<ExternalPlayerSession>;
    autoUpdatePlaylists: (
        playlists: Playlist[],
        options?: ElectronBridgeTrustOptions
    ) => Promise<Playlist[]>;
    fetchEpg: (
        urls: string[],
        options?: ElectronBridgeTrustOptions
    ) => Promise<ElectronBridgeEpgFetchResult>;
    getChannelPrograms: (
        channelId: string,
        options?: ElectronBridgeEpgLookupOptions
    ) => Promise<EpgProgram[]>;
    getCurrentProgramsBatch: (
        channelIds: string[],
        options?: ElectronBridgeEpgLookupOptions
    ) => Promise<Record<string, EpgProgram | null>>;
    getEpgChannelMetadata: (
        channelIds: string[],
        options?: ElectronBridgeEpgLookupOptions
    ) => Promise<Record<string, EpgChannelMetadata | null>>;
    getEpgChannels: () => Promise<ElectronBridgeEpgChannelListResult>;
    getEpgChannelsByRange: (
        skip: number,
        limit: number
    ) => Promise<ElectronBridgeEpgChannelWithPrograms[]>;
    forceFetchEpg: (
        url: string,
        options?: ElectronBridgeTrustOptions
    ) => Promise<ElectronBridgeEpgFetchResult>;
    clearEpgData: () => Promise<ElectronBridgeResult>;
    clearEpgDataForSource: (sourceUrl: string) => Promise<ElectronBridgeResult>;
    checkEpgFreshness: (
        urls: string[],
        maxAgeHours?: number
    ) => Promise<ElectronBridgeEpgFreshnessResult>;
    searchEpgPrograms: (
        searchTerm: string,
        limit?: number
    ) => Promise<EpgProgram[]>;
    updateSettings: (settings: Partial<Settings>) => Promise<void>;
    getAiSettings: () => Promise<ElectronBridgeAiSettings>;
    setMpvPlayerPath: (mpvPlayerPath: string) => Promise<void>;
    setVlcPlayerPath: (vlcPlayerPath: string) => Promise<void>;
    stalkerRequest: (
        payload: ElectronBridgeStalkerRequestPayload
    ) => Promise<Record<string, unknown>>;
    xtreamRequest: (
        payload: ElectronBridgeXtreamRequestPayload
    ) => Promise<ElectronBridgeXtreamResponse>;
    xtreamCancelSession: (
        sessionId: string
    ) => Promise<ElectronBridgeXtreamCancelResult>;
    xtreamProbeUrl: (
        url: string,
        method?: 'GET' | 'HEAD'
    ) => Promise<ElectronBridgeXtreamProbeResult>;
    refreshPlaylist: (payload: PlaylistRefreshPayload) => Promise<Playlist>;
    cancelPlaylistRefresh: (
        operationId: string
    ) => Promise<ElectronBridgeResult>;
    dbCreatePlaylist: (
        playlist: ElectronBridgePlaylistUpsertInput
    ) => Promise<ElectronBridgeResult>;
    dbGetPlaylist: (
        playlistId: string
    ) => Promise<ElectronBridgePlaylistRow | null>;
    dbUpsertAppPlaylist: (playlist: Playlist) => Promise<ElectronBridgeResult>;
    dbUpsertAppPlaylists: (
        playlists: Playlist[]
    ) => Promise<ElectronBridgeCountResult>;
    dbGetAppPlaylists: () => Promise<Playlist[]>;
    dbGetAppPlaylistMetas: () => Promise<Playlist[]>;
    dbGetAppPlaylist: (playlistId: string) => Promise<Playlist | null>;
    dbGetAppPlaylistFavoriteChannels: (
        playlistId: string
    ) => Promise<M3uFavoriteChannel[]>;
    dbUpdatePlaylist: (
        playlistId: string,
        updates: Partial<Playlist> | ElectronBridgePlaylistInput
    ) => Promise<ElectronBridgeResult>;
    dbDeletePlaylist: (
        playlistId: string,
        operationId?: string
    ) => Promise<ElectronBridgeResult>;
    dbDeleteXtreamContent: (
        playlistId: string,
        operationId?: string
    ) => Promise<{
        success: boolean;
        favorites: XtreamBackupFavoriteItem[];
        recentlyViewed: XtreamBackupRecentlyViewedItem[];
        hiddenCategories: XtreamBackupHiddenCategory[];
    }>;
    dbRestoreXtreamUserData: (
        playlistId: string,
        favorites: XtreamBackupFavoriteItem[],
        recentlyViewed: XtreamBackupRecentlyViewedItem[],
        operationId?: string
    ) => Promise<ElectronBridgeResult>;
    dbHasCategories: (playlistId: string, type: string) => Promise<boolean>;
    dbGetCategories: (
        playlistId: string,
        type: string
    ) => Promise<ElectronBridgeCategoryRow[]>;
    dbSaveCategories: (
        playlistId: string,
        categories: XtreamCategory[],
        type: string,
        hiddenCategoryXtreamIds?: number[]
    ) => Promise<ElectronBridgeResult>;
    dbGetAllCategories: (
        playlistId: string,
        type: string
    ) => Promise<ElectronBridgeCategoryRow[]>;
    dbUpdateCategoryVisibility: (
        categoryIds: number[],
        hidden: boolean
    ) => Promise<ElectronBridgeResult>;
    dbHasContent: (playlistId: string, type: string) => Promise<boolean>;
    dbGetContent: (
        playlistId: string,
        type: string
    ) => Promise<ElectronBridgeXtreamContent[]>;
    dbSaveContent: (
        playlistId: string,
        streams: ElectronBridgeXtreamContentStream[],
        type: string,
        operationId?: string
    ) => Promise<ElectronBridgeCountResult>;
    dbClearXtreamImportCache: (
        playlistId: string,
        type: ElectronBridgePortalContentType
    ) => Promise<ElectronBridgeResult>;
    dbSearchContent: (
        playlistId: string,
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean
    ) => Promise<ElectronBridgeXtreamContent[]>;
    dbGlobalSearch: (
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean,
        sources?: GlobalSearchResultSource[],
        options?: GlobalSearchPaginationOptions
    ) => Promise<ElectronBridgeGlobalSearchResult[]>;
    dbGetGlobalRecentlyAdded: (
        kind: ElectronBridgeGlobalRecentlyAddedKind,
        limit?: number,
        playlistType?: ElectronBridgePlaylistType
    ) => Promise<ElectronBridgeGlobalRecentlyAddedItem[]>;
    dbGetRecentlyViewed: () => Promise<ElectronBridgeGlobalRecentItem[]>;
    dbClearRecentlyViewed: () => Promise<ElectronBridgeResult>;
    dbAddFavorite: (
        contentId: number,
        playlistId: string,
        backdropUrl?: string
    ) => Promise<ElectronBridgeResult>;
    dbRemoveFavorite: (
        contentId: number,
        playlistId: string
    ) => Promise<ElectronBridgeResult>;
    dbIsFavorite: (contentId: number, playlistId: string) => Promise<boolean>;
    dbGetFavorites: (
        playlistId: string
    ) => Promise<ElectronBridgeXtreamContent[]>;
    dbGetGlobalFavorites: () => Promise<ElectronBridgeGlobalFavoriteItem[]>;
    dbGetAllGlobalFavorites: () => Promise<ElectronBridgeGlobalFavoriteItem[]>;
    dbReorderGlobalFavorites: (
        updates: ElectronBridgeFavoriteReorderUpdate[]
    ) => Promise<ElectronBridgeResult>;
    dbGetRecentItems: (
        playlistId: string
    ) => Promise<ElectronBridgeXtreamContent[]>;
    dbAddRecentItem: (
        contentId: number,
        playlistId: string,
        backdropUrl?: string
    ) => Promise<ElectronBridgeResult>;
    dbClearPlaylistRecentItems: (
        playlistId: string
    ) => Promise<ElectronBridgeResult>;
    dbRemoveRecentItem: (
        contentId: number,
        playlistId: string
    ) => Promise<ElectronBridgeResult>;
    dbRemoveRecentItemsBatch: (
        items: ElectronBridgeRecentItemsBatchItem[]
    ) => Promise<ElectronBridgeCountResult>;
    dbGetContentByXtreamId: (
        xtreamId: number,
        playlistId: string,
        contentType?: ElectronBridgePortalContentType
    ) => Promise<ElectronBridgeXtreamContent | null>;
    dbSetContentBackdropIfMissing: (
        contentId: number,
        backdropUrl?: string
    ) => Promise<ElectronBridgeResult>;
    dbGetAppState: (key: string) => Promise<string | null>;
    dbSetAppState: (
        key: string,
        value: string
    ) => Promise<ElectronBridgeResult>;
    onChannelChange?: (
        callback: (data: { direction: 'up' | 'down' }) => void
    ) => () => void;
    onRemoteControlCommand?: (
        callback: (data: ElectronBridgeRemoteControlCommand) => void
    ) => () => void;
    updateRemoteControlStatus?: (
        status: ElectronBridgeRemoteControlStatus
    ) => void;
    onPlayerError?: (
        callback: (data: ElectronBridgePlayerError) => void
    ) => void;
    getLocalIpAddresses: () => Promise<string[]>;
    onEpgProgress?: (
        callback: (data: ElectronBridgeEpgProgress) => void
    ) => void;
    onDbSaveContentProgress: (callback: (count: number) => void) => void;
    removeDbSaveContentProgress: () => void;
    onDbOperationEvent?: (
        callback: (data: ElectronBridgeDbOperationEvent) => void
    ) => () => void;
    dbDeleteAllPlaylists: (
        operationId?: string
    ) => Promise<ElectronBridgeResult>;
    dbCancelOperation: (operationId: string) => Promise<ElectronBridgeResult>;
    dbSavePlaybackPosition: (
        playlistId: string,
        data: ElectronBridgePlaybackPositionInput
    ) => Promise<ElectronBridgeResult>;
    dbGetPlaybackPosition: (
        playlistId: string,
        contentXtreamId: number,
        contentType: ElectronBridgePlaybackContentType
    ) => Promise<PlaybackPositionData | null>;
    dbGetSeriesPlaybackPositions: (
        playlistId: string,
        seriesXtreamId: number
    ) => Promise<PlaybackPositionData[]>;
    dbGetRecentPlaybackPositions: (
        playlistId: string,
        limit?: number
    ) => Promise<PlaybackPositionData[]>;
    dbGetAllPlaybackPositions: (
        playlistId: string
    ) => Promise<PlaybackPositionData[]>;
    dbClearAllPlaybackPositions: (
        playlistId: string
    ) => Promise<ElectronBridgeResult>;
    dbClearPlaybackPosition: (
        playlistId: string,
        contentXtreamId: number,
        contentType: ElectronBridgePlaybackContentType
    ) => Promise<ElectronBridgeResult>;
    onPlaybackPositionUpdate: (
        callback: (data: PlaybackPositionData) => void
    ) => () => void;
    onExternalPlayerSessionUpdate?: (
        callback: (data: ExternalPlayerSession) => void
    ) => () => void;
    onEmbeddedMpvSessionUpdate?: (
        callback: (data: EmbeddedMpvSession) => void
    ) => () => void;
    closeExternalPlayerSession: (
        sessionId: string
    ) => Promise<ExternalPlayerSession | null>;
    getEmbeddedMpvSupport: () => Promise<EmbeddedMpvSupport>;
    prepareEmbeddedMpv?: () => Promise<EmbeddedMpvSupport>;
    createEmbeddedMpvSession: (
        bounds: EmbeddedMpvBounds,
        title?: string,
        initialVolume?: number
    ) => Promise<EmbeddedMpvSession>;
    loadEmbeddedMpvPlayback: (
        sessionId: string,
        playback: ResolvedPortalPlayback
    ) => Promise<void>;
    setEmbeddedMpvBounds: (
        sessionId: string,
        bounds: EmbeddedMpvBounds
    ) => Promise<void>;
    setEmbeddedMpvPaused: (
        sessionId: string,
        paused: boolean
    ) => Promise<EmbeddedMpvSession | null>;
    seekEmbeddedMpv: (
        sessionId: string,
        seconds: number
    ) => Promise<EmbeddedMpvSession | null>;
    setEmbeddedMpvVolume: (
        sessionId: string,
        volume: number
    ) => Promise<EmbeddedMpvSession | null>;
    setEmbeddedMpvAudioTrack: (
        sessionId: string,
        trackId: number
    ) => Promise<EmbeddedMpvSession | null>;
    setEmbeddedMpvSubtitleTrack?: (
        sessionId: string,
        trackId: number
    ) => Promise<EmbeddedMpvSession | null>;
    setEmbeddedMpvSpeed?: (
        sessionId: string,
        speed: number
    ) => Promise<EmbeddedMpvSession | null>;
    setEmbeddedMpvAspect?: (
        sessionId: string,
        aspect: string
    ) => Promise<EmbeddedMpvSession | null>;
    startEmbeddedMpvRecording?: (
        sessionId: string,
        options: EmbeddedMpvRecordingStartOptions
    ) => Promise<EmbeddedMpvSession | null>;
    stopEmbeddedMpvRecording?: (
        sessionId: string
    ) => Promise<EmbeddedMpvSession | null>;
    getEmbeddedMpvDefaultRecordingFolder?: () => Promise<string>;
    selectEmbeddedMpvRecordingFolder?: () => Promise<string | null>;
    disposeEmbeddedMpvSession: (
        sessionId: string
    ) => Promise<EmbeddedMpvSession | null>;
    downloadsStart: (
        data: ElectronBridgeDownloadStartPayload
    ) => Promise<ElectronBridgeDownloadStartResult>;
    downloadsCancel: (downloadId: number) => Promise<ElectronBridgeErrorResult>;
    downloadsRetry: (
        downloadId: number,
        downloadFolder: string
    ) => Promise<ElectronBridgeErrorResult>;
    downloadsRemove: (downloadId: number) => Promise<ElectronBridgeErrorResult>;
    downloadsGetList: (playlistId?: string) => Promise<ElectronDownloadItem[]>;
    downloadsGet: (downloadId: number) => Promise<ElectronDownloadItem | null>;
    downloadsGetDefaultFolder: () => Promise<string>;
    downloadsSelectFolder: () => Promise<string | null>;
    downloadsRevealFile: (
        filePath: string
    ) => Promise<ElectronBridgeErrorResult>;
    downloadsPlayFile: (filePath: string) => Promise<ElectronBridgeErrorResult>;
    downloadsClearCompleted: (
        playlistId?: string
    ) => Promise<ElectronBridgeResult>;
    onDownloadsUpdate: (callback: () => void) => () => void;
}
