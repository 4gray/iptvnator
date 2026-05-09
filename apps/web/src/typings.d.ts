/* SystemJS module definition */
declare const nodeModule: NodeModule;
interface NodeModule {
    id: string;
}

import {
    EmbeddedMpvBounds,
    EmbeddedMpvRecordingStartOptions,
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    EpgChannel,
    EpgChannelMetadata,
    EpgProgram,
    ExternalPlayerSession,
    PlaybackPositionData,
    Playlist,
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
    PortalDebugEvent,
    ResolvedPortalPlayback,
    XtreamBackupFavoriteItem,
    XtreamBackupHiddenCategory,
    XtreamBackupRecentlyViewedItem,
    XtreamCategory,
} from 'shared-interfaces';
import {
    DbOperationEvent,
    GlobalFavoriteItem,
    GlobalRecentlyAddedItem,
    GlobalRecentItem,
    GlobalSearchResult,
    XCategoryFromDb,
    XtreamContent,
} from 'services';

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

declare global {
    interface Window {
        electron: {
            onPortalDebugEvent?: (
                callback: (data: PortalDebugEvent) => void
            ) => () => void;
            onPlaylistRefreshEvent?: (
                callback: (data: PlaylistRefreshEvent) => void
            ) => () => void;
            getAppVersion: () => Promise<string>;
            platform: string;
            fetchPlaylistByUrl: (
                url: string,
                title?: string
            ) => Promise<Playlist>;
            updatePlaylistFromFilePath: (
                filePath: string,
                title: string
            ) => Promise<Playlist>;
            openPlaylistFromFile: () => Promise<Playlist | null>;
            getPathForFile: (file: File) => string;
            saveFileDialog: (
                defaultPath: string,
                filters?: { name: string; extensions: string[] }[]
            ) => Promise<string | null>;
            writeFile: (
                filePath: string,
                content: string
            ) => Promise<{ success: boolean }>;
            setUserAgent: (userAgent: string, referer?: string) => void;
            openInMpv: (
                url: string,
                title: string,
                thumbnail: string,
                userAgent: string,
                referer?: string,
                origin?: string,
                contentInfo?: unknown,
                startTime?: number,
                headers?: Record<string, string>
            ) => Promise<ExternalPlayerSession>;
            openInVlc: (
                url: string,
                title: string,
                thumbnail: string,
                userAgent: string,
                referer?: string,
                origin?: string,
                contentInfo?: unknown,
                startTime?: number,
                headers?: Record<string, string>
            ) => Promise<ExternalPlayerSession>;
            autoUpdatePlaylists: (playlists: Playlist[]) => Promise<Playlist[]>;
            fetchEpg: (urls: string[]) => Promise<{
                success: boolean;
                message?: string;
                skipped?: string[];
            }>;
            getChannelPrograms: (channelId: string) => Promise<EpgProgram[]>;
            getCurrentProgramsBatch: (
                channelIds: string[]
            ) => Promise<Record<string, EpgProgram | null>>;
            getEpgChannelMetadata: (
                channelIds: string[]
            ) => Promise<Record<string, EpgChannelMetadata | null>>;
            getEpgChannels: () => Promise<EpgChannel[]>;
            getEpgChannelsByRange: (
                skip: number,
                limit: number
            ) => Promise<EpgChannel[]>;
            forceFetchEpg: (
                url: string
            ) => Promise<{ success: boolean; message?: string }>;
            clearEpgData: () => Promise<{ success: boolean }>;
            checkEpgFreshness: (
                urls: string[],
                maxAgeHours?: number
            ) => Promise<{ staleUrls: string[]; freshUrls: string[] }>;
            searchEpgPrograms: (
                searchTerm: string,
                limit?: number
            ) => Promise<EpgProgram[]>;
            updateSettings: (settings: JsonObject) => Promise<void>;
            getAiSettings: () => Promise<{
                aiProvider: string;
                aiModelName: string;
                aiApiKey: string;
            }>;
            setMpvPlayerPath: (mpvPlayerPath: string) => Promise<void>;
            setVlcPlayerPath: (vlcPlayerPath: string) => Promise<void>;
            stalkerRequest: (payload: {
                url: string;
                macAddress: string;
                params: Record<string, string>;
                token?: string;
                serialNumber?: string;
                requestId?: string;
            }) => Promise<JsonObject>;
            xtreamRequest: (payload: {
                url: string;
                params: Record<string, string>;
                requestId?: string;
                sessionId?: string;
                suppressErrorLog?: boolean;
            }) => Promise<{ payload: unknown; action: string }>;
            xtreamCancelSession: (
                sessionId: string
            ) => Promise<{ success: boolean; cancelled: number }>;
            xtreamProbeUrl: (
                url: string,
                method?: 'GET' | 'HEAD'
            ) => Promise<{ status: number; url: string }>;
            refreshPlaylist: (
                payload: PlaylistRefreshPayload
            ) => Promise<Playlist>;
            cancelPlaylistRefresh: (
                operationId: string
            ) => Promise<{ success: boolean }>;
            // Database operations
            dbCreatePlaylist: (
                playlist: Playlist
            ) => Promise<{ success: boolean }>;
            dbGetPlaylist: (playlistId: string) => Promise<Playlist | null>;
            dbUpsertAppPlaylist: (
                playlist: Playlist
            ) => Promise<{ success: boolean }>;
            dbUpsertAppPlaylists: (
                playlists: Playlist[]
            ) => Promise<{ success: boolean; count: number }>;
            dbGetAppPlaylists: () => Promise<Playlist[]>;
            dbGetAppPlaylist: (playlistId: string) => Promise<Playlist | null>;
            dbUpdatePlaylist: (
                playlistId: string,
                updates: Partial<Playlist>
            ) => Promise<{ success: boolean }>;
            dbDeletePlaylist: (
                playlistId: string,
                operationId?: string
            ) => Promise<{ success: boolean }>;
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
            ) => Promise<{ success: boolean }>;
            dbHasCategories: (
                playlistId: string,
                type: string
            ) => Promise<boolean>;
            dbGetCategories: (
                playlistId: string,
                type: string
            ) => Promise<XCategoryFromDb[]>;
            dbSaveCategories: (
                playlistId: string,
                categories: XtreamCategory[],
                type: string,
                hiddenCategoryXtreamIds?: number[]
            ) => Promise<{ success: boolean }>;
            dbGetAllCategories: (
                playlistId: string,
                type: string
            ) => Promise<XCategoryFromDb[]>;
            dbUpdateCategoryVisibility: (
                categoryIds: number[],
                hidden: boolean
            ) => Promise<{ success: boolean }>;
            dbHasContent: (
                playlistId: string,
                type: string
            ) => Promise<boolean>;
            dbGetContent: (
                playlistId: string,
                type: string
            ) => Promise<XtreamContent[]>;
            dbSaveContent: (
                playlistId: string,
                streams: JsonArray,
                type: string,
                operationId?: string
            ) => Promise<{ success: boolean; count: number }>;
            dbClearXtreamImportCache: (
                playlistId: string,
                type: 'live' | 'movie' | 'series'
            ) => Promise<{ success: boolean }>;
            dbSearchContent: (
                playlistId: string,
                searchTerm: string,
                types: string[],
                excludeHidden?: boolean
            ) => Promise<XtreamContent[]>;
            dbGlobalSearch: (
                searchTerm: string,
                types: string[],
                excludeHidden?: boolean
            ) => Promise<GlobalSearchResult[]>;
            dbGetGlobalRecentlyAdded: (
                kind: 'all' | 'vod' | 'series',
                limit?: number
            ) => Promise<GlobalRecentlyAddedItem[]>;
            dbGetRecentlyViewed: () => Promise<GlobalRecentItem[]>;
            dbClearRecentlyViewed: () => Promise<{ success: boolean }>;
            // Favorites
            dbAddFavorite: (
                contentId: number,
                playlistId: string,
                backdropUrl?: string
            ) => Promise<{ success: boolean }>;
            dbRemoveFavorite: (
                contentId: number,
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbIsFavorite: (
                contentId: number,
                playlistId: string
            ) => Promise<boolean>;
            dbGetFavorites: (playlistId: string) => Promise<XtreamContent[]>;
            dbGetGlobalFavorites: () => Promise<GlobalFavoriteItem[]>;
            dbGetAllGlobalFavorites: () => Promise<GlobalFavoriteItem[]>;
            dbReorderGlobalFavorites: (
                updates: { content_id: number; position: number }[]
            ) => Promise<{ success: boolean }>;
            // Recently viewed (playlist-specific)
            dbGetRecentItems: (playlistId: string) => Promise<XtreamContent[]>;
            dbAddRecentItem: (
                contentId: number,
                playlistId: string,
                backdropUrl?: string
            ) => Promise<{ success: boolean }>;
            dbClearPlaylistRecentItems: (
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbRemoveRecentItem: (
                contentId: number,
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbRemoveRecentItemsBatch: (
                items: { contentId: number; playlistId: string }[]
            ) => Promise<{ success: boolean; count: number }>;
            dbGetContentByXtreamId: (
                xtreamId: number,
                playlistId: string,
                contentType?: 'live' | 'movie' | 'series'
            ) => Promise<XtreamContent | null>;
            dbSetContentBackdropIfMissing: (
                contentId: number,
                backdropUrl?: string
            ) => Promise<{ success: boolean }>;
            dbGetAppState: (key: string) => Promise<string | null>;
            dbSetAppState: (
                key: string,
                value: string
            ) => Promise<{ success: boolean }>;
            // Remote control
            onChannelChange?: (
                callback: (data: { direction: 'up' | 'down' }) => void
            ) => () => void;
            onRemoteControlCommand?: (
                callback: (data: {
                    type:
                        | 'channel-select-number'
                        | 'volume-up'
                        | 'volume-down'
                        | 'volume-toggle-mute';
                    number?: number;
                }) => void
            ) => () => void;
            updateRemoteControlStatus?: (status: {
                portal: 'm3u' | 'xtream' | 'stalker' | 'unknown';
                isLiveView: boolean;
                channelName?: string;
                channelNumber?: number;
                epgTitle?: string;
                epgStart?: string;
                epgEnd?: string;
                supportsVolume?: boolean;
                volume?: number;
                muted?: boolean;
            }) => void;
            // Player error notifications
            onPlayerError?: (
                callback: (data: {
                    player: string;
                    error: string;
                    originalError: string;
                }) => void
            ) => void;
            onEmbeddedMpvSessionUpdate?: (
                callback: (data: EmbeddedMpvSession) => void
            ) => () => void;
            onExternalPlayerSessionUpdate?: (
                callback: (data: ExternalPlayerSession) => void
            ) => () => void;
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
            getLocalIpAddresses: () => Promise<string[]>;
            // EPG progress listener
            onEpgProgress?: (
                callback: (data: {
                    url: string;
                    status: 'loading' | 'complete' | 'error';
                    stats?: { totalChannels: number; totalPrograms: number };
                    error?: string;
                }) => void
            ) => void;
            // DB save content progress listener
            onDbSaveContentProgress: (
                callback: (count: number) => void
            ) => void;
            removeDbSaveContentProgress: () => void;
            onDbOperationEvent?: (
                callback: (data: DbOperationEvent) => void
            ) => () => void;
            dbDeleteAllPlaylists: (
                operationId?: string
            ) => Promise<{ success: boolean }>;
            dbCancelOperation: (
                operationId: string
            ) => Promise<{ success: boolean }>;
            // Playback positions
            dbSavePlaybackPosition: (
                playlistId: string,
                data: {
                    contentXtreamId: number;
                    contentType: 'vod' | 'episode';
                    seriesXtreamId?: number;
                    seasonNumber?: number;
                    episodeNumber?: number;
                    position: number;
                    duration: number;
                    title: string;
                    posterUrl?: string;
                }
            ) => Promise<{ success: boolean }>;
            dbGetPlaybackPosition: (
                playlistId: string,
                contentXtreamId: number,
                contentType: 'vod' | 'episode'
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
            ) => Promise<{ success: boolean }>;
            dbClearPlaybackPosition: (
                playlistId: string,
                contentXtreamId: number,
                contentType: 'vod' | 'episode'
            ) => Promise<{ success: boolean }>;
            onPlaybackPositionUpdate: (
                callback: (data: PlaybackPositionData) => void
            ) => () => void;
            closeExternalPlayerSession: (
                sessionId: string
            ) => Promise<ExternalPlayerSession | null>;
            // Downloads
            downloadsStart: (data: {
                playlistId: string;
                xtreamId: number;
                contentType: 'vod' | 'episode';
                title: string;
                url: string;
                posterUrl?: string;
                downloadFolder: string;
                headers?: {
                    userAgent?: string;
                    referer?: string;
                    origin?: string;
                };
                seriesXtreamId?: number;
                seasonNumber?: number;
                episodeNumber?: number;
                // Playlist info for auto-creation if needed
                playlistName?: string;
                playlistType?:
                    | 'xtream'
                    | 'stalker'
                    | 'm3u-file'
                    | 'm3u-text'
                    | 'm3u-url';
                serverUrl?: string;
                portalUrl?: string;
                macAddress?: string;
            }) => Promise<{ success: boolean; id?: number; error?: string }>;
            downloadsCancel: (
                downloadId: number
            ) => Promise<{ success: boolean; error?: string }>;
            downloadsRetry: (
                downloadId: number,
                downloadFolder: string
            ) => Promise<{ success: boolean; error?: string }>;
            downloadsRemove: (
                downloadId: number
            ) => Promise<{ success: boolean; error?: string }>;
            downloadsGetList: (playlistId?: string) => Promise<DownloadItem[]>;
            downloadsGet: (downloadId: number) => Promise<DownloadItem | null>;
            downloadsGetDefaultFolder: () => Promise<string>;
            downloadsSelectFolder: () => Promise<string | null>;
            downloadsRevealFile: (
                filePath: string
            ) => Promise<{ success: boolean; error?: string }>;
            downloadsPlayFile: (
                filePath: string
            ) => Promise<{ success: boolean; error?: string }>;
            downloadsClearCompleted: (
                playlistId?: string
            ) => Promise<{ success: boolean }>;
            onDownloadsUpdate: (callback: () => void) => () => void;
        };
        process: NodeJS.Process;
        require: NodeRequire;
    }

    /** Download item from the database */
    interface DownloadItem {
        id: number;
        playlistId: string;
        xtreamId: number;
        contentType: 'vod' | 'episode';
        seriesXtreamId?: number;
        seasonNumber?: number;
        episodeNumber?: number;
        title: string;
        url: string;
        fileName?: string;
        filePath?: string;
        posterUrl?: string;
        status: 'queued' | 'downloading' | 'completed' | 'failed' | 'canceled';
        bytesDownloaded?: number;
        totalBytes?: number;
        errorMessage?: string;
        createdAt?: string;
        updatedAt?: string;
    }
}
