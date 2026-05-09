import 'jest-extended';
import { EmbeddedMpvBounds } from './libs/shared/interfaces/src/lib/embedded-mpv-session.interface';
import { EmbeddedMpvRecordingStartOptions } from './libs/shared/interfaces/src/lib/embedded-mpv-session.interface';
import { EmbeddedMpvSession } from './libs/shared/interfaces/src/lib/embedded-mpv-session.interface';
import { EmbeddedMpvSupport } from './libs/shared/interfaces/src/lib/embedded-mpv-session.interface';
import { ExternalPlayerSession } from './libs/shared/interfaces/src/lib/external-player-session.interface';
import { PlaybackPositionData } from './libs/shared/interfaces/src/lib/playback-position.interface';
import {
    XtreamBackupFavoriteItem,
    XtreamBackupHiddenCategory,
    XtreamBackupRecentlyViewedItem,
} from './libs/shared/interfaces/src/lib/playlist-backup.interface';
import {
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
} from './libs/shared/interfaces/src/lib/playlist-refresh.interface';
import { Playlist } from './libs/shared/interfaces/src/lib/playlist.interface';
import { ResolvedPortalPlayback } from './libs/shared/interfaces/src/lib/portal-playback.interface';

declare module 'video.js' {
    export interface VideoJsPlayer {
        hlsQualitySelector(options?: Record<string, unknown>): void;
    }
}

declare global {
    interface ElectronDbOperationEvent {
        operationId?: string;
        operation: string;
        playlistId?: string;
        status: 'started' | 'progress' | 'completed' | 'cancelled' | 'error';
        phase?: string;
        current?: number;
        total?: number;
        increment?: number;
        error?: string;
    }

    interface Window {
        electron: {
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
            openPlaylistFromFile: () => Promise<Playlist>;
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
                contentInfo?: any,
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
                contentInfo?: any,
                startTime?: number,
                headers?: Record<string, string>
            ) => Promise<ExternalPlayerSession>;
            autoUpdatePlaylists: (playlists: Playlist[]) => Promise<Playlist[]>;
            fetchEpg: (
                urls: string[]
            ) => Promise<{ success: boolean; message?: string }>;
            getChannelPrograms: (channelId: string) => Promise<any>;
            getCurrentProgramsBatch: (
                channelIds: string[]
            ) => Promise<Record<string, any>>;
            getEpgChannels: () => Promise<any>;
            getEpgChannelsByRange: (
                skip: number,
                limit: number
            ) => Promise<any>;
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
            ) => Promise<any[]>;
            updateSettings: (settings: any) => Promise<void>;
            getAiSettings: () => Promise<{
                aiProvider: string;
                aiModelName: string;
                aiApiKey: string;
            }>;
            setMpvPlayerPath: (mpvPlayerPath: string) => Promise<void>;
            setVlcPlayerPath: (vlcPlayerPath: string) => Promise<void>;
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
            stalkerRequest: (payload: {
                url: string;
                macAddress: string;
                params: Record<string, string>;
                token?: string;
                serialNumber?: string;
                requestId?: string;
            }) => Promise<any>;
            xtreamRequest: (payload: {
                url: string;
                params: Record<string, string>;
                requestId?: string;
                sessionId?: string;
                suppressErrorLog?: boolean;
            }) => Promise<{ payload: any; action: string }>;
            xtreamCancelSession: (
                sessionId: string
            ) => Promise<{ success: boolean; cancelled: number }>;
            refreshPlaylist: (
                payload: PlaylistRefreshPayload
            ) => Promise<Playlist>;
            cancelPlaylistRefresh: (
                operationId: string
            ) => Promise<{ success: boolean }>;
            // Database operations
            dbCreatePlaylist: (playlist: any) => Promise<{ success: boolean }>;
            dbGetPlaylist: (playlistId: string) => Promise<any>;
            dbUpsertAppPlaylist: (
                playlist: any
            ) => Promise<{ success: boolean }>;
            dbUpsertAppPlaylists: (
                playlists: any[]
            ) => Promise<{ success: boolean; count: number }>;
            dbGetAppPlaylists: () => Promise<any[]>;
            dbGetAppPlaylist: (playlistId: string) => Promise<any | null>;
            dbUpdatePlaylist: (
                playlistId: string,
                updates: any
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
            ) => Promise<any[]>;
            dbSaveCategories: (
                playlistId: string,
                categories: any[],
                type: string,
                hiddenCategoryXtreamIds?: number[]
            ) => Promise<{ success: boolean }>;
            dbGetAllCategories: (
                playlistId: string,
                type: string
            ) => Promise<any[]>;
            dbUpdateCategoryVisibility: (
                categoryIds: number[],
                hidden: boolean
            ) => Promise<{ success: boolean }>;
            dbHasContent: (
                playlistId: string,
                type: string
            ) => Promise<boolean>;
            dbGetContent: (playlistId: string, type: string) => Promise<any[]>;
            dbSaveContent: (
                playlistId: string,
                streams: any[],
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
            ) => Promise<any[]>;
            dbGlobalSearch: (
                searchTerm: string,
                types: string[],
                excludeHidden?: boolean
            ) => Promise<any[]>;
            dbGetGlobalRecentlyAdded: (
                kind: 'all' | 'vod' | 'series',
                limit?: number,
                playlistType?:
                    | 'xtream'
                    | 'stalker'
                    | 'm3u-file'
                    | 'm3u-text'
                    | 'm3u-url'
            ) => Promise<any[]>;
            dbGetRecentlyViewed: () => Promise<any[]>;
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
            dbGetFavorites: (playlistId: string) => Promise<any[]>;
            dbGetGlobalFavorites: () => Promise<any[]>;
            dbGetAllGlobalFavorites: () => Promise<any[]>;
            dbReorderGlobalFavorites: (
                updates: { content_id: number; position: number }[]
            ) => Promise<{ success: boolean }>;
            // Recently viewed (playlist-specific)
            dbGetRecentItems: (playlistId: string) => Promise<any[]>;
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
            ) => Promise<any | null>;
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
                callback: (data: ElectronDbOperationEvent) => void
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
                data: any
            ) => Promise<{ success: boolean }>;
            dbGetPlaybackPosition: (
                playlistId: string,
                contentXtreamId: number,
                contentType: 'vod' | 'episode'
            ) => Promise<any | null>;
            dbGetSeriesPlaybackPositions: (
                playlistId: string,
                seriesXtreamId: number
            ) => Promise<any[]>;
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
                callback: (data: any) => void
            ) => () => void;
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

// SystemJS module definition
declare const nodeModule: NodeModule;
interface NodeModule {
    id: string;
}
