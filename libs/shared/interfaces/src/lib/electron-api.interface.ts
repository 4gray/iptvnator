import {
    EmbeddedMpvBounds,
    EmbeddedMpvRecordingStartOptions,
    EmbeddedMpvSession,
    EmbeddedMpvSubtitleStyle,
    EmbeddedMpvSupport,
} from './embedded-mpv-session.interface';
import { ContentMetadataPatch } from './content-metadata.interface';
import { DownloadMetadataSnapshot } from './download-metadata.interface';
import { EpgChannelMetadata } from './epg-channel-metadata.model';
import { EpgProgram } from './epg-program.model';
import { ExternalPlayerSession } from './external-player-session.interface';
import {
    GlobalSearchPaginationOptions,
    GlobalSearchResult,
    GlobalSearchResultSource,
} from './global-search-result.interface';
import { M3uFavoriteChannel } from './m3u-favorite-channel.interface';
import {
    RecordingProgramSnapshot,
    RecordingSourceType,
    RecordingStatus,
} from './recording-metadata.interface';
import { PlaybackPositionData } from './playback-position.interface';
import { AutoUpdatePlaylistsResult } from './playlist-auto-update.interface';
import {
    XtreamBackupFavoriteItem,
    XtreamBackupHiddenCategory,
    XtreamBackupRecentlyViewedItem,
} from './playlist-backup.interface';
import {
    PlaylistRefreshCancelledResult,
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
} from './playlist-refresh.interface';
import { Playlist } from './playlist.interface';
import {
    PlayerContentInfo,
    ResolvedPortalPlayback,
} from './portal-playback.interface';
import { PortalDebugEvent } from './portal-debug.interface';
import { CatalogTitleMatch } from './catalog-title-match.interface';
import {
    StreamProbeHeaders,
    VodSourceCandidateRow,
    VodSourcePin,
} from './vod-source.interface';
import { Settings } from './settings.interface';
import {
    TmdbCacheEntry,
    TmdbCacheMediaType,
    TmdbCacheStats,
} from './tmdb.interface';
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
    Paused: 'paused',
    Queued: 'queued',
} as const;

export type ElectronBridgeDownloadStatus =
    (typeof ELECTRON_BRIDGE_DOWNLOAD_STATUSES)[keyof typeof ELECTRON_BRIDGE_DOWNLOAD_STATUSES];

export const ELECTRON_BRIDGE_DOWNLOAD_START_REASONS = {
    AlreadyDownloaded: 'already-downloaded',
    AlreadyInProgress: 'already-in-progress',
} as const;

export type ElectronBridgeDownloadStartReason =
    (typeof ELECTRON_BRIDGE_DOWNLOAD_START_REASONS)[keyof typeof ELECTRON_BRIDGE_DOWNLOAD_START_REASONS];

export const ELECTRON_BRIDGE_EPISODE_IDENTITY_SCOPES = {
    StalkerEmbeddedVod: 'stalker-embedded-vod',
    StalkerLazyVod: 'stalker-lazy-vod',
    StalkerRegularSeries: 'stalker-regular-series',
} as const;

export type ElectronBridgeEpisodeIdentityScope =
    (typeof ELECTRON_BRIDGE_EPISODE_IDENTITY_SCOPES)[keyof typeof ELECTRON_BRIDGE_EPISODE_IDENTITY_SCOPES];

export type ElectronDownloadFileAvailability =
    'available' | 'missing' | 'not-applicable';

export const ELECTRON_BRIDGE_APP_UPDATE_STATUSES = {
    Unsupported: 'unsupported',
    Idle: 'idle',
    Checking: 'checking',
    Available: 'available',
    NotAvailable: 'not-available',
    Downloading: 'downloading',
    Downloaded: 'downloaded',
    Error: 'error',
} as const;

export type ElectronBridgeAppUpdateStatusValue =
    (typeof ELECTRON_BRIDGE_APP_UPDATE_STATUSES)[keyof typeof ELECTRON_BRIDGE_APP_UPDATE_STATUSES];

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

/**
 * Portal credentials for an auth-gated stream, passed alongside the scoped
 * header override. The main process attaches them only to requests going to
 * the exact origin of the override's `scopeUrl`, keeps them in memory only,
 * and drops them when the scoped override is cleared or replaced.
 */
export interface ElectronBridgeStreamCredentials {
    authorization?: string | null;
    cookie?: string | null;
}

/**
 * A playlist file the operating system asked the app to open — a command line
 * argument, a file association double-click, or macOS' `open-file` event. The
 * main process resolves the path to an absolute one before handing it over.
 */
export interface ElectronBridgePlaylistOpenRequest {
    fileName: string;
    filePath: string;
    /** Pass back to `acknowledgePlaylistOpenRequest` once received. */
    requestId: string;
}

export interface ElectronBridgeAppUpdateRelease {
    version: string;
    releaseDate?: string;
    releaseName?: string | null;
    releaseNotes?: string | null;
}

export interface ElectronBridgeAppUpdateProgress {
    bytesPerSecond?: number;
    percent: number;
    total?: number;
    transferred?: number;
}

export interface ElectronBridgeAppUpdateStatus {
    status: ElectronBridgeAppUpdateStatusValue;
    currentVersion: string;
    latestVersion?: string;
    release?: ElectronBridgeAppUpdateRelease;
    progress?: ElectronBridgeAppUpdateProgress;
    error?: string;
    supportedSelfUpdate: boolean;
    manualDownloadUrl: string;
}

export type ElectronBridgeAppUpdateReleaseNotesDirection = 'previous' | 'next';

export interface ElectronBridgeAppUpdateReleaseNotesRequest {
    version?: string;
    direction?: ElectronBridgeAppUpdateReleaseNotesDirection;
    fallbackToLatest?: boolean;
}

export interface ElectronBridgeAppUpdateReleaseNotes {
    version: string;
    tagName: string;
    releaseName?: string | null;
    publishedAt?: string | null;
    bodyMarkdown: string;
    htmlUrl: string;
    hasPrevious: boolean;
    hasNext: boolean;
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
    /**
     * Endpoint-discovery probes only: exempt this request from the main
     * process' per-host connectivity guard. Discovery walks several candidate
     * paths on one host and expects most of them to fail, so its failures must
     * neither count towards the guard nor be fast-failed by it.
     */
    skipConnectionGuard?: boolean;
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
    /**
     * HTTP status, or 0 when no response was obtained.
     *
     * 0 covers a timeout and a URL rejected by the redirect-safety policy as
     * well as a dead host, so it means "could not check" — never "offline".
     */
    status: number;
    url: string;
    /** Round-trip time; present whenever the request completed either way. */
    latencyMs?: number;
    error?: string;
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

export interface ElectronBridgeEpgMapping {
    id: number;
    channelKey: string;
    epgChannelId: string;
    playlistId: string | null;
}

export interface ElectronBridgeEpgSearchResult {
    id: string;
    displayName: string;
    iconUrl: string | null;
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
    Playlist | ElectronBridgePlaylistInput;

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
    /** Favorites are playlist-scoped — scope the position write per playlist */
    playlist_id: string;
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
    metadataSnapshot?: DownloadMetadataSnapshot;
    downloadFolder: string;
    headers?: ElectronBridgeDownloadHeaders;
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    episodeIdentityScope?: ElectronBridgeEpisodeIdentityScope;
    playlistName?: string;
    playlistType?: ElectronBridgePlaylistType;
    serverUrl?: string;
    portalUrl?: string;
    macAddress?: string;
}

export interface ElectronBridgeDownloadStartResult extends ElectronBridgeErrorResult {
    id?: number;
    reason?: ElectronBridgeDownloadStartReason;
}

export interface ElectronBridgeDownloadRedownloadResult extends ElectronBridgeErrorResult {
    recovered?: boolean;
}

export interface ElectronDownloadItem {
    id: number;
    playlistId: string;
    xtreamId: number;
    contentType: ElectronBridgePlaybackContentType;
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    episodeIdentityScope?: ElectronBridgeEpisodeIdentityScope | null;
    title: string;
    url: string;
    fileName?: string;
    filePath?: string;
    posterUrl?: string;
    metadataSnapshot?: DownloadMetadataSnapshot;
    status: ElectronBridgeDownloadStatus;
    fileAvailability: ElectronDownloadFileAvailability;
    bytesDownloaded?: number;
    totalBytes?: number;
    errorMessage?: string;
    createdAt?: string;
    updatedAt?: string;
}

/**
 * Renderer-facing live-TV recording row. `fileAvailability` is derived at
 * read time (never persisted) and `programs` is the decoded `programs_json`
 * column. Recordings reuse the download availability vocabulary so the
 * manager UI can share its missing-file affordances — extended by
 * `'unknown'` for an inconclusive probe (timeout, permission or I/O error):
 * only proven absence may move a recording to Needs attention or hide its
 * file actions, so consumers gate on `=== 'missing'`, never on
 * `!== 'available'`.
 */
export interface ElectronRecordingItem {
    id: number;
    sessionId?: string;
    status: RecordingStatus;
    filePath: string;
    fileSizeBytes?: number;
    channelName: string;
    channelLogoUrl?: string;
    playlistId?: string;
    playlistName?: string;
    sourceType?: RecordingSourceType;
    epgChannelId?: string;
    programTitle?: string;
    programDescription?: string;
    programStart?: string;
    programStop?: string;
    programs?: RecordingProgramSnapshot[];
    errorMessage?: string;
    startedAt: string;
    endedAt?: string;
    createdAt?: string;
    updatedAt?: string;
    fileAvailability: ElectronDownloadFileAvailability | 'unknown';
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
    getAppUpdateStatus: () => Promise<ElectronBridgeAppUpdateStatus>;
    checkForAppUpdate: () => Promise<ElectronBridgeAppUpdateStatus>;
    downloadAppUpdate: () => Promise<ElectronBridgeAppUpdateStatus>;
    installAppUpdate: () => Promise<ElectronBridgeAppUpdateStatus>;
    getAppUpdateReleaseNotes: (
        request?: ElectronBridgeAppUpdateReleaseNotesRequest
    ) => Promise<ElectronBridgeAppUpdateReleaseNotes>;
    onAppUpdateStatusChange: (
        callback: (status: ElectronBridgeAppUpdateStatus) => void
    ) => () => void;
    minimizeWindow: () => Promise<void>;
    toggleMaximizeWindow: () => Promise<ElectronBridgeWindowState>;
    /**
     * Toggles OS-level window fullscreen (F11). Reports the requested state;
     * the `onWindowStateChange` push stays authoritative once the window
     * manager has acted.
     */
    toggleFullScreenWindow: () => Promise<ElectronBridgeWindowState>;
    closeWindow: () => Promise<void>;
    getWindowState: () => Promise<ElectronBridgeWindowState>;
    onWindowStateChange: (
        callback: (state: ElectronBridgeWindowState) => void
    ) => () => void;
    /**
     * While active, the main process intercepts window close / app quit and
     * pushes a close request to the renderer instead of closing. Used by the
     * settings page while its form holds unsaved edits.
     */
    setWindowCloseGuard: (active: boolean) => Promise<void>;
    /**
     * Completes a close the guard intercepted: the main process re-runs the
     * original intent (window close or app quit) with the guard bypassed.
     */
    confirmWindowClose: () => Promise<void>;
    /**
     * Abandons a close the guard intercepted (the user stays), so the
     * remembered close-vs-quit intent cannot leak into a later attempt.
     * Carries the id of the request being abandoned: a cancellation that
     * arrives after a NEWER interception must not wipe that newer intent.
     */
    cancelWindowClose: (requestId?: number) => Promise<void>;
    onWindowCloseRequested: (
        callback: (requestId: number) => void
    ) => () => void;
    /**
     * While active, the main process holds a
     * `powerSaveBlocker('prevent-display-sleep')` so the screen stays awake
     * during built-in video playback. The flag is cleared automatically when
     * the renderer navigates, reloads, or dies, so a crashed page can never
     * leave the display pinned awake.
     */
    setPlaybackKeepAwake: (active: boolean) => Promise<void>;
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
    onPlaylistOpenRequest: (
        callback: (request: ElectronBridgePlaylistOpenRequest) => void
    ) => () => void;
    /**
     * Tells the main process that an `onPlaylistOpenRequest` listener is
     * attached, so it can push the playlist files the OS handed over — both
     * the ones queued before this renderer existed and any that arrive later.
     * Call it *after* subscribing.
     */
    announcePlaylistOpenListener: () => Promise<void>;
    /**
     * Confirms a pushed request reached this renderer. Until it does, the main
     * process keeps the request and replays it to the next renderer.
     */
    acknowledgePlaylistOpenRequest: (requestId: string) => Promise<void>;
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
        scopeUrl?: string | null,
        credentials?: ElectronBridgeStreamCredentials | null
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
    ) => Promise<AutoUpdatePlaylistsResult>;
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

    // EPG channel mapping (manual user overrides)
    getEpgMapping: (
        channelKey: string
    ) => Promise<ElectronBridgeEpgMapping | null>;
    getEpgMappingsBatch: (
        channelKeys: string[]
    ) => Promise<Record<string, string>>;
    setEpgMapping: (
        channelKey: string,
        epgChannelId: string,
        playlistId?: string
    ) => Promise<ElectronBridgeResult>;
    deleteEpgMapping: (channelKey: string) => Promise<ElectronBridgeResult>;
    searchEpgChannels: (
        searchTerm: string,
        limit?: number
    ) => Promise<ElectronBridgeEpgSearchResult[]>;

    updateSettings: (settings: Partial<Settings>) => Promise<void>;
    getAiSettings: () => Promise<ElectronBridgeAiSettings>;
    setMpvPlayerPath: (mpvPlayerPath: string) => Promise<void>;
    setVlcPlayerPath: (vlcPlayerPath: string) => Promise<void>;
    stalkerRequest: (
        payload: ElectronBridgeStalkerRequestPayload
    ) => Promise<Record<string, unknown>>;
    /**
     * Forgets the connection failures recorded for the host `url` points at, so
     * the next request contacts it for real instead of being fast-failed.
     */
    resetHostConnectivityGuard: (url: string) => Promise<ElectronBridgeResult>;
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
    /** Generic stream reachability probe (VOD multi-source availability) */
    probeStreamUrl: (
        url: string,
        method?: 'GET' | 'HEAD',
        /** Playback headers the owning playlist requires, when it has any. */
        headers?: StreamProbeHeaders
    ) => Promise<ElectronBridgeXtreamProbeResult>;
    refreshPlaylist: (
        payload: PlaylistRefreshPayload
    ) => Promise<Playlist | PlaylistRefreshCancelledResult>;
    cancelPlaylistRefresh: (
        operationId: string
    ) => Promise<ElectronBridgeResult>;
    dbCreatePlaylist: (
        playlist: ElectronBridgePlaylistUpsertInput
    ) => Promise<ElectronBridgeResult>;
    dbGetPlaylist: (
        playlistId: string
    ) => Promise<ElectronBridgePlaylistRow | null>;
    dbUpsertAppPlaylist: (
        playlist: Playlist,
        /**
         * Instrumentation-only; stripped before the DB invoke.
         * Never enters the DB worker payload or persisted playlist data.
         */
        operationId?: string
    ) => Promise<ElectronBridgeResult>;
    dbUpsertAppPlaylists: (
        playlists: Playlist[]
    ) => Promise<ElectronBridgeCountResult>;
    dbGetAppPlaylists: () => Promise<Playlist[]>;
    dbGetAppPlaylistMetas: () => Promise<Playlist[]>;
    dbGetAppPlaylist: (
        playlistId: string,
        /**
         * Instrumentation-only; stripped before the DB invoke.
         * Never enters the DB worker payload or persisted playlist data.
         */
        operationId?: string
    ) => Promise<Playlist | null>;
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
    dbSetContentMetadataIfMissing: (
        contentId: number,
        patch?: ContentMetadataPatch
    ) => Promise<ElectronBridgeResult>;
    dbGetAppState: (key: string) => Promise<string | null>;
    dbSetAppState: (
        key: string,
        value: string
    ) => Promise<ElectronBridgeResult>;
    // TMDB metadata cache
    dbGetTmdbMetadata: (
        mediaType: TmdbCacheMediaType,
        lookupKey: string,
        language: string
    ) => Promise<TmdbCacheEntry | null>;
    dbSetTmdbMetadata: (entry: TmdbCacheEntry) => Promise<ElectronBridgeResult>;
    /** Row count + payload bytes for the settings cache panel */
    dbGetTmdbCacheStats: () => Promise<TmdbCacheStats>;
    dbClearTmdbMetadata: () => Promise<
        ElectronBridgeResult & { deleted: number }
    >;
    /** Cross-playlist title matching (actor page "All portals" scope) */
    dbMatchTitles: (titles: string[]) => Promise<CatalogTitleMatch[]>;
    /** VOD multi-source: the same movie in the user's other Xtream playlists */
    dbFindTitleSources: (request: {
        title: string;
        year?: number | null;
        excludePlaylistId?: string | null;
        /** A stream id inside the excluded playlist to keep anyway (a pin). */
        keepContentId?: number | null;
    }) => Promise<VodSourceCandidateRow[]>;
    /** Per-movie pinned source; keys are passed most-trusted first */
    dbGetVodSourcePin: (matchKeys: string[]) => Promise<VodSourcePin | null>;
    /** Every pin pointing at this playlist — used by playlist backup. */
    dbListVodSourcePins: (playlistId: string) => Promise<VodSourcePin[]>;
    /** Bulk clear: not keyed, so no `MAX_KEYS_PER_LOOKUP` truncation. */
    dbClearVodSourcePinsForPlaylist: (
        playlistId: string
    ) => Promise<ElectronBridgeResult>;
    /**
     * `aliasKeys` receive the same pin, and `retireKeys` are removed, all in
     * the SAME transaction as the write. Aliases keep a pin readable under the
     * poorer key forms the movie had before enrichment.
     */
    dbSetVodSourcePin: (
        pin: VodSourcePin,
        retireKeys?: string[],
        aliasKeys?: string[]
    ) => Promise<ElectronBridgeResult>;
    /** Makes the playlist's pins exactly `pins`, in one transaction. */
    dbReplaceVodSourcePins: (
        playlistId: string,
        pins: VodSourcePin[]
    ) => Promise<ElectronBridgeResult>;
    dbClearVodSourcePin: (matchKeys: string[]) => Promise<ElectronBridgeResult>;
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
    dbSavePlaybackPositionsBatch: (
        playlistId: string,
        items: ElectronBridgePlaybackPositionInput[]
    ) => Promise<ElectronBridgeResult>;
    dbClearPlaybackPositionsBatch: (
        playlistId: string,
        items: {
            contentXtreamId: number;
            contentType: ElectronBridgePlaybackContentType;
        }[]
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
    /**
     * Relative seek by `deltaSeconds` (negative = backwards), resolved by mpv
     * against its own playback position. Keyboard and button steps must use
     * this instead of `seekEmbeddedMpv(position + delta)`: the renderer's
     * `positionSeconds` is a whole-second snapshot refreshed at most every
     * 500 ms and a seek reply does not carry the new position yet, so rapid
     * presses computed from it collapse onto one target. mpv merges queued
     * relative seeks instead, so presses accumulate.
     */
    seekEmbeddedMpvBy?: (
        sessionId: string,
        deltaSeconds: number
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
    /** Loads an external subtitle file (absolute path) via mpv `sub-add`. */
    addEmbeddedMpvSubtitle?: (
        sessionId: string,
        filePath: string
    ) => Promise<EmbeddedMpvSession | null>;
    setEmbeddedMpvSubtitleDelay?: (
        sessionId: string,
        seconds: number
    ) => Promise<EmbeddedMpvSession | null>;
    setEmbeddedMpvSubtitleStyle?: (
        sessionId: string,
        style: EmbeddedMpvSubtitleStyle
    ) => Promise<EmbeddedMpvSession | null>;
    /** Opens the main-process subtitle file dialog; null when cancelled. */
    selectEmbeddedMpvSubtitleFile?: () => Promise<string | null>;
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
    /**
     * Frame-copy engine only: start/stop the preload frame pump that
     * uploads helper frames onto the renderer's
     * `<canvas data-embedded-mpv-frame>` element. Optional because older
     * preload builds do not ship the pump.
     */
    attachEmbeddedMpvFrameView?: (sessionId: string) => Promise<boolean>;
    detachEmbeddedMpvFrameView?: () => void;
    downloadsStart: (
        data: ElectronBridgeDownloadStartPayload
    ) => Promise<ElectronBridgeDownloadStartResult>;
    downloadsCancel: (downloadId: number) => Promise<ElectronBridgeErrorResult>;
    downloadsPause: (downloadId: number) => Promise<ElectronBridgeErrorResult>;
    downloadsResume: (
        downloadId: number,
        downloadFolder: string
    ) => Promise<ElectronBridgeErrorResult>;
    downloadsRetry: (
        downloadId: number,
        downloadFolder: string
    ) => Promise<ElectronBridgeErrorResult>;
    downloadsRedownloadMissing: (
        downloadId: number
    ) => Promise<ElectronBridgeDownloadRedownloadResult>;
    downloadsRemove: (downloadId: number) => Promise<ElectronBridgeErrorResult>;
    downloadsGetList: (playlistId?: string) => Promise<ElectronDownloadItem[]>;
    downloadsGet: (downloadId: number) => Promise<ElectronDownloadItem | null>;
    downloadsUpdateMetadata: (
        downloadId: number,
        metadataSnapshot: DownloadMetadataSnapshot
    ) => Promise<ElectronBridgeErrorResult>;
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
    // Live-TV recordings surface. Optional: older Electron builds have no
    // recordings bridge, and `supportsRecordings` (not `supportsDownloads`)
    // gates every consumer.
    recordingsGetList?: (
        playlistId?: string
    ) => Promise<ElectronRecordingItem[]>;
    recordingsGet?: (
        recordingId: number
    ) => Promise<ElectronRecordingItem | null>;
    recordingsStop?: (recordingId: number) => Promise<ElectronBridgeErrorResult>;
    recordingsRemove?: (
        recordingId: number
    ) => Promise<ElectronBridgeErrorResult>;
    recordingsUpdatePrograms?: (
        targetPath: string,
        programs: RecordingProgramSnapshot[]
    ) => Promise<ElectronBridgeErrorResult>;
    recordingsRevealFile?: (
        filePath: string
    ) => Promise<ElectronBridgeErrorResult>;
    recordingsPlayFile?: (
        filePath: string
    ) => Promise<ElectronBridgeErrorResult>;
    onRecordingsUpdate?: (callback: () => void) => () => void;
}
