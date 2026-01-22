/* SystemJS module definition */
declare const nodeModule: NodeModule;
interface NodeModule {
    id: string;
}
interface Window {
    process: any;
    require: any;
    electron: {
        // Core
        getAppVersion: () => Promise<string>;
        platform: string;
        
        // Listeners
        onChannelChange: (callback: (data: { direction: 'up' | 'down' }) => void) => void;
        onPlayerError: (callback: (data: { player: string; error: string; originalError: string }) => void) => void;
        onEpgProgress: (callback: (data: { url: string; status: 'loading' | 'complete' | 'error'; stats?: { totalChannels: number; totalPrograms: number }; error?: string }) => void) => void;
        onDbSaveContentProgress: (callback: (count: number) => void) => void;
        removeDbSaveContentProgress: () => void;
        onPlaybackPositionUpdate: (callback: (data: any) => void) => () => void;

        // Files & System
        saveFileDialog: (defaultPath: string, filters?: { name: string; extensions: string[] }[]) => Promise<any>;
        writeFile: (filePath: string, content: string) => Promise<void>;
        getLocalIpAddresses: () => Promise<string[]>;

        // Playlist
        fetchPlaylistByUrl: (url: string, title?: string) => Promise<any>;
        updatePlaylistFromFilePath: (filePath: string, title: string) => Promise<any>;
        openPlaylistFromFile: () => Promise<any>;
        autoUpdatePlaylists: (playlists: any[]) => Promise<any[]>;
        dbDeleteAllPlaylists: () => Promise<void>;

        // Player
        setUserAgent: (userAgent: string, referer?: string) => Promise<void>;
        openInMpv: (url: string, title: string, userAgent: string, referer?: string, origin?: string, contentInfo?: any, startTime?: number) => Promise<void>;
        openInVlc: (url: string, title: string, userAgent: string, referer?: string, origin?: string, contentInfo?: any, startTime?: number) => Promise<void>;
        setMpvPlayerPath: (mpvPlayerPath: string) => Promise<void>;
        setVlcPlayerPath: (vlcPlayerPath: string) => Promise<void>;

        // EPG
        fetchEpg: (urls: string[]) => Promise<{ success: boolean; message?: string; skipped?: string[] }>;
        getChannelPrograms: (channelId: string) => Promise<any>;
        getEpgChannels: () => Promise<any>;
        getEpgChannelsByRange: (skip: number, limit: number) => Promise<any>;
        forceFetchEpg: (url: string) => Promise<void>;
        clearEpgData: () => Promise<void>;
        checkEpgFreshness: (urls: string[], maxAgeHours?: number) => Promise<any>;
        searchEpgPrograms: (searchTerm: string, limit?: number) => Promise<any>;

        // Settings & Requests
        updateSettings: (settings: any) => Promise<void>;
        getAiSettings: () => Promise<any>;
        stalkerRequest: (payload: any) => Promise<any>;
        xtreamRequest: (payload: any) => Promise<any>;

        // Database - Playlists & Content
        dbCreatePlaylist: (playlist: any) => Promise<void>;
        dbGetPlaylist: (playlistId: string) => Promise<any>;
        dbUpdatePlaylist: (playlistId: string, updates: any) => Promise<void>;
        dbDeletePlaylist: (playlistId: string) => Promise<void>;
        dbDeleteXtreamContent: (playlistId: string) => Promise<any>;
        dbRestoreXtreamUserData: (playlistId: string, favoritedXtreamIds: number[], recentlyViewedXtreamIds: any[]) => Promise<void>;
        
        // Database - Categories & Content
        dbHasCategories: (playlistId: string, type: string) => Promise<boolean>;
        dbGetCategories: (playlistId: string, type: string) => Promise<any[]>;
        dbSaveCategories: (playlistId: string, categories: any[], type: string, hiddenCategoryXtreamIds?: number[]) => Promise<void>;
        dbGetAllCategories: (playlistId: string, type: string) => Promise<any[]>;
        dbUpdateCategoryVisibility: (categoryIds: number[], hidden: boolean) => Promise<void>;
        dbHasContent: (playlistId: string, type: string) => Promise<boolean>;
        dbGetContent: (playlistId: string, type: string) => Promise<any[]>;
        dbSaveContent: (playlistId: string, streams: any[], type: string) => Promise<any>;
        dbSearchContent: (playlistId: string, searchTerm: string, types: string[]) => Promise<any[]>;
        dbGlobalSearch: (searchTerm: string, types: string[]) => Promise<any[]>;
        dbGetContentByXtreamId: (xtreamId: number, playlistId: string) => Promise<any>;

        // Database - Favorites & Recent
        dbGetRecentlyViewed: () => Promise<any[]>;
        dbClearRecentlyViewed: () => Promise<void>;
        dbAddFavorite: (contentId: number, playlistId: string) => Promise<void>;
        dbRemoveFavorite: (contentId: number, playlistId: string) => Promise<void>;
        dbIsFavorite: (contentId: number, playlistId: string) => Promise<boolean>;
        dbGetFavorites: (playlistId: string) => Promise<any[]>;
        dbGetRecentItems: (playlistId: string) => Promise<any[]>;
        dbAddRecentItem: (contentId: number, playlistId: string) => Promise<void>;
        dbClearPlaylistRecentItems: (playlistId: string) => Promise<void>;
        dbRemoveRecentItem: (contentId: number, playlistId: string) => Promise<void>;

        // Database - Playback Positions
        dbSavePlaybackPosition: (playlistId: string, data: any) => Promise<void>;
        dbGetPlaybackPosition: (playlistId: string, contentXtreamId: number, contentType: 'vod' | 'episode') => Promise<any>;
        dbGetSeriesPlaybackPositions: (playlistId: string, seriesXtreamId: number) => Promise<any[]>;
        dbGetRecentPlaybackPositions: (playlistId: string, limit?: number) => Promise<any[]>;
        dbGetAllPlaybackPositions: (playlistId: string) => Promise<any[]>;
        dbClearPlaybackPosition: (playlistId: string, contentXtreamId: number, contentType: 'vod' | 'episode') => Promise<void>;
    };
}

/* export interface ParsedPlaylist {
    header: {
        attrs: {
            'x-tvg-url': string;
        };
        raw: string;
    };
    items: ParsedPlaylistItem[];
}

export interface ParsedPlaylistItem {
    name: string;
    tvg: {
        id: string;
        name: string;
        url: string;
        logo: string;
        rec: string;
    };
    group: {
        title: string;
    };
    http: {
        referrer: string;
        'user-agent': string;
    };
    url: string;
    raw: string;
}
 */
