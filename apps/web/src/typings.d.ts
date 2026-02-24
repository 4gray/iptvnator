/* SystemJS module definition */
declare const nodeModule: NodeModule;
interface NodeModule {
    id: string;
}

declare global {
    interface Window {
        electron: {
            getAppVersion: () => Promise<string>;
            platform: string;
            fetchPlaylistByUrl: (
                url: string,
                title?: string
            ) => Promise<any>;
            updatePlaylistFromFilePath: (
                filePath: string,
                title: string
            ) => Promise<any>;
            openPlaylistFromFile: () => Promise<any>;
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
                userAgent: string,
                referer?: string,
                origin?: string,
                contentInfo?: any,
                startTime?: number
            ) => void;
            openInVlc: (
                url: string,
                title: string,
                userAgent: string,
                referer?: string,
                origin?: string,
                contentInfo?: any,
                startTime?: number
            ) => void;
            autoUpdatePlaylists: (playlists: any[]) => Promise<any[]>;
            fetchEpg: (
                urls: string[]
            ) => Promise<{ success: boolean; message?: string; skipped?: string[] }>;
            getChannelPrograms: (channelId: string) => Promise<any>;
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
            stalkerRequest: (payload: {
                url: string;
                macAddress: string;
                params: Record<string, string>;
                token?: string;
            }) => Promise<any>;
            xtreamRequest: (payload: {
                url: string;
                params: Record<string, string>;
            }) => Promise<{ payload: any; action: string }>;
            // Database operations
            dbCreatePlaylist: (playlist: any) => Promise<{ success: boolean }>;
            dbGetPlaylist: (playlistId: string) => Promise<any>;
            dbUpdatePlaylist: (
                playlistId: string,
                updates: any
            ) => Promise<{ success: boolean }>;
            dbDeletePlaylist: (
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbDeleteXtreamContent: (playlistId: string) => Promise<{
                success: boolean;
                favoritedXtreamIds: number[];
                recentlyViewedXtreamIds: {
                    xtreamId: number;
                    viewedAt: string;
                }[];
                hiddenCategories: {
                    xtreamId: number;
                    type: string;
                }[];
            }>;
            dbRestoreXtreamUserData: (
                playlistId: string,
                favoritedXtreamIds: number[],
                recentlyViewedXtreamIds: {
                    xtreamId: number;
                    viewedAt: string;
                }[]
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
                type: string
            ) => Promise<{ success: boolean; count: number }>;
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
            dbGetRecentlyViewed: () => Promise<any[]>;
            dbClearRecentlyViewed: () => Promise<{ success: boolean }>;
            // Favorites
            dbAddFavorite: (
                contentId: number,
                playlistId: string
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
            // Recently viewed (playlist-specific)
            dbGetRecentItems: (playlistId: string) => Promise<any[]>;
            dbAddRecentItem: (
                contentId: number,
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbClearPlaylistRecentItems: (
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbRemoveRecentItem: (
                contentId: number,
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbGetContentByXtreamId: (
                xtreamId: number,
                playlistId: string
            ) => Promise<any | null>;
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
            onDbSaveContentProgress: (callback: (count: number) => void) => void;
            removeDbSaveContentProgress: () => void;
            dbDeleteAllPlaylists: () => Promise<{ success: boolean }>;
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
            ) => Promise<any | null>;
            dbGetSeriesPlaybackPositions: (
                playlistId: string,
                seriesXtreamId: number
            ) => Promise<any[]>;
            dbGetRecentPlaybackPositions: (
                playlistId: string,
                limit?: number
            ) => Promise<any[]>;
            dbGetAllPlaybackPositions: (
                playlistId: string
            ) => Promise<any[]>;
            dbClearPlaybackPosition: (
                playlistId: string,
                contentXtreamId: number,
                contentType: 'vod' | 'episode'
            ) => Promise<{ success: boolean }>;
            onPlaybackPositionUpdate: (callback: (data: any) => void) => () => void;
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
                playlistType?: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';
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
