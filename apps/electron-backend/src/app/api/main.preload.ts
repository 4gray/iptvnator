import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
    // Remote control channel change listener
    onChannelChange: (
        callback: (data: { direction: 'up' | 'down' }) => void
    ) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data);
        ipcRenderer.on('CHANNEL_CHANGE', handler);
        return () => ipcRenderer.off('CHANNEL_CHANGE', handler);
    },
    onRemoteControlCommand: (
        callback: (data: {
            type:
                | 'channel-select-number'
                | 'volume-up'
                | 'volume-down'
                | 'volume-toggle-mute';
            number?: number;
        }) => void
    ) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data);
        ipcRenderer.on('REMOTE_CONTROL_COMMAND', handler);
        return () => ipcRenderer.off('REMOTE_CONTROL_COMMAND', handler);
    },
    updateRemoteControlStatus: (status: any) => {
        ipcRenderer.send('REMOTE_CONTROL_STATUS_UPDATE', status);
    },
    // Player error listener
    onPlayerError: (
        callback: (data: {
            player: string;
            error: string;
            originalError: string;
        }) => void
    ) => {
        ipcRenderer.on('player-error', (_event, data) => callback(data));
    },
    // EPG progress listener
    onEpgProgress: (
        callback: (data: {
            url: string;
            status: 'loading' | 'complete' | 'error';
            stats?: { totalChannels: number; totalPrograms: number };
            error?: string;
        }) => void
    ) => {
        ipcRenderer.on('EPG_PROGRESS_UPDATE', (_event, data) => callback(data));
    },
    // Playback position update listener - returns unsubscribe function
    onPlaybackPositionUpdate: (callback: (data: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data);
        ipcRenderer.on('playback-position-update', handler);
        return () => ipcRenderer.off('playback-position-update', handler);
    },
    // DB save content progress listener
    onDbSaveContentProgress: (callback: (count: number) => void) => {
        ipcRenderer.on('DB_SAVE_CONTENT_PROGRESS', (_event, count) =>
            callback(count)
        );
    },
    // Remove DB save content progress listener
    removeDbSaveContentProgress: () => {
        ipcRenderer.removeAllListeners('DB_SAVE_CONTENT_PROGRESS');
    },
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    platform: process.platform,
    fetchPlaylistByUrl: (url: string, title?: string) =>
        ipcRenderer.invoke('fetch-playlist-by-url', url, title),
    updatePlaylistFromFilePath: (filePath: string, title: string) =>
        ipcRenderer.invoke('update-playlist-from-file-path', filePath, title),
    openPlaylistFromFile: () => ipcRenderer.invoke('open-playlist-from-file'),
    saveFileDialog: (
        defaultPath: string,
        filters?: { name: string; extensions: string[] }[]
    ) => ipcRenderer.invoke('save-file-dialog', defaultPath, filters),
    writeFile: (filePath: string, content: string) =>
        ipcRenderer.invoke('write-file', filePath, content),
    setUserAgent: (userAgent: string, referer?: string) =>
        ipcRenderer.invoke('set-user-agent', userAgent, referer),
    openInMpv: (
        url: string,
        title: string,
        userAgent: string,
        referer?: string,
        origin?: string,
        contentInfo?: any,
        startTime?: number
    ) =>
        ipcRenderer.invoke(
            'OPEN_MPV_PLAYER',
            url,
            title,
            userAgent,
            referer,
            origin,
            contentInfo,
            startTime
        ),
    openInVlc: (
        url: string,
        title: string,
        userAgent: string,
        referer?: string,
        origin?: string,
        contentInfo?: any,
        startTime?: number
    ) =>
        ipcRenderer.invoke(
            'OPEN_VLC_PLAYER',
            url,
            title,
            userAgent,
            referer,
            origin,
            contentInfo,
            startTime
        ),
    autoUpdatePlaylists: (playlists) =>
        ipcRenderer.invoke('AUTO_UPDATE', playlists),
    fetchEpg: (urls: string[]) =>
        ipcRenderer.invoke('FETCH_EPG', { url: urls }),
    getChannelPrograms: (channelId: string) =>
        ipcRenderer.invoke('GET_CHANNEL_PROGRAMS', { channelId }),
    getEpgChannels: () => ipcRenderer.invoke('EPG_GET_CHANNELS'),
    getEpgChannelsByRange: (skip: number, limit: number) =>
        ipcRenderer.invoke('EPG_GET_CHANNELS_BY_RANGE', { skip, limit }),
    forceFetchEpg: (url: string) => ipcRenderer.invoke('EPG_FORCE_FETCH', url),
    clearEpgData: () => ipcRenderer.invoke('EPG_CLEAR_ALL'),
    checkEpgFreshness: (urls: string[], maxAgeHours?: number) =>
        ipcRenderer.invoke('EPG_CHECK_FRESHNESS', { urls, maxAgeHours }),
    searchEpgPrograms: (searchTerm: string, limit?: number) =>
        ipcRenderer.invoke('EPG_DB_SEARCH_PROGRAMS', searchTerm, limit),
    setMpvPlayerPath: (mpvPlayerPath: string) =>
        ipcRenderer.invoke('SET_MPV_PLAYER_PATH', mpvPlayerPath),
    setVlcPlayerPath: (vlcPlayerPath: string) =>
        ipcRenderer.invoke('SET_VLC_PLAYER_PATH', vlcPlayerPath),
    updateSettings: (settings: any) =>
        ipcRenderer.invoke('SETTINGS_UPDATE', settings),
    getAiSettings: () => ipcRenderer.invoke('GET_AI_SETTINGS'),
    stalkerRequest: (payload: {
        url: string;
        macAddress: string;
        params: Record<string, string>;
        token?: string;
    }) => ipcRenderer.invoke('STALKER_REQUEST', payload),
    xtreamRequest: (payload: { url: string; params: Record<string, string> }) =>
        ipcRenderer.invoke('XTREAM_REQUEST', payload),
    // Database operations
    dbCreatePlaylist: (playlist: any) =>
        ipcRenderer.invoke('DB_CREATE_PLAYLIST', playlist),
    dbGetPlaylist: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_PLAYLIST', playlistId),
    dbUpdatePlaylist: (playlistId: string, updates: any) =>
        ipcRenderer.invoke('DB_UPDATE_PLAYLIST', playlistId, updates),
    dbDeletePlaylist: (playlistId: string) =>
        ipcRenderer.invoke('DB_DELETE_PLAYLIST', playlistId),
    dbDeleteXtreamContent: (playlistId: string) =>
        ipcRenderer.invoke('DB_DELETE_XTREAM_CONTENT', playlistId),
    dbRestoreXtreamUserData: (
        playlistId: string,
        favoritedXtreamIds: number[],
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[]
    ) =>
        ipcRenderer.invoke(
            'DB_RESTORE_XTREAM_USER_DATA',
            playlistId,
            favoritedXtreamIds,
            recentlyViewedXtreamIds
        ),
    dbHasCategories: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_HAS_CATEGORIES', playlistId, type),
    dbGetCategories: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_GET_CATEGORIES', playlistId, type),
    dbSaveCategories: (
        playlistId: string,
        categories: any[],
        type: string,
        hiddenCategoryXtreamIds?: number[]
    ) =>
        ipcRenderer.invoke(
            'DB_SAVE_CATEGORIES',
            playlistId,
            categories,
            type,
            hiddenCategoryXtreamIds
        ),
    dbGetAllCategories: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_GET_ALL_CATEGORIES', playlistId, type),
    dbUpdateCategoryVisibility: (categoryIds: number[], hidden: boolean) =>
        ipcRenderer.invoke(
            'DB_UPDATE_CATEGORY_VISIBILITY',
            categoryIds,
            hidden
        ),
    dbHasContent: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_HAS_CONTENT', playlistId, type),
    dbGetContent: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_GET_CONTENT', playlistId, type),
    dbSaveContent: (playlistId: string, streams: any[], type: string) =>
        ipcRenderer.invoke('DB_SAVE_CONTENT', playlistId, streams, type),
    dbSearchContent: (
        playlistId: string,
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean
    ) => ipcRenderer.invoke('DB_SEARCH_CONTENT', playlistId, searchTerm, types, excludeHidden),
    dbGlobalSearch: (searchTerm: string, types: string[], excludeHidden?: boolean) =>
        ipcRenderer.invoke('DB_GLOBAL_SEARCH', searchTerm, types, excludeHidden),
    dbGetRecentlyViewed: () => ipcRenderer.invoke('DB_GET_RECENTLY_VIEWED'),
    dbClearRecentlyViewed: () => ipcRenderer.invoke('DB_CLEAR_RECENTLY_VIEWED'),
    // Favorites
    dbAddFavorite: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_ADD_FAVORITE', contentId, playlistId),
    dbRemoveFavorite: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_REMOVE_FAVORITE', contentId, playlistId),
    dbIsFavorite: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_IS_FAVORITE', contentId, playlistId),
    dbGetFavorites: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_FAVORITES', playlistId),
    dbGetGlobalFavorites: () => ipcRenderer.invoke('DB_GET_GLOBAL_FAVORITES'),
    // Recently viewed (playlist-specific)
    dbGetRecentItems: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_RECENT_ITEMS', playlistId),
    dbAddRecentItem: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_ADD_RECENT_ITEM', contentId, playlistId),
    dbClearPlaylistRecentItems: (playlistId: string) =>
        ipcRenderer.invoke('DB_CLEAR_PLAYLIST_RECENT_ITEMS', playlistId),
    dbRemoveRecentItem: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_REMOVE_RECENT_ITEM', contentId, playlistId),
    dbGetContentByXtreamId: (xtreamId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_GET_CONTENT_BY_XTREAM_ID', xtreamId, playlistId),
    dbDeleteAllPlaylists: () => ipcRenderer.invoke('DB_DELETE_ALL_PLAYLISTS'),
    // Playback Positions
    dbSavePlaybackPosition: (playlistId: string, data: any) =>
        ipcRenderer.invoke('DB_SAVE_PLAYBACK_POSITION', playlistId, data),
    dbGetPlaybackPosition: (
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ) =>
        ipcRenderer.invoke(
            'DB_GET_PLAYBACK_POSITION',
            playlistId,
            contentXtreamId,
            contentType
        ),
    dbGetSeriesPlaybackPositions: (
        playlistId: string,
        seriesXtreamId: number
    ) =>
        ipcRenderer.invoke(
            'DB_GET_SERIES_PLAYBACK_POSITIONS',
            playlistId,
            seriesXtreamId
        ),
    dbGetRecentPlaybackPositions: (playlistId: string, limit?: number) =>
        ipcRenderer.invoke(
            'DB_GET_RECENT_PLAYBACK_POSITIONS',
            playlistId,
            limit
        ),
    dbGetAllPlaybackPositions: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_ALL_PLAYBACK_POSITIONS', playlistId),
    dbClearPlaybackPosition: (
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ) =>
        ipcRenderer.invoke(
            'DB_CLEAR_PLAYBACK_POSITION',
            playlistId,
            contentXtreamId,
            contentType
        ),
    getLocalIpAddresses: () => ipcRenderer.invoke('get-local-ip-addresses'),
    // Downloads
    downloadsStart: (data: {
        playlistId: string;
        xtreamId: number;
        contentType: 'vod' | 'episode';
        title: string;
        url: string;
        posterUrl?: string;
        downloadFolder: string;
        headers?: { userAgent?: string; referer?: string; origin?: string };
        seriesXtreamId?: number;
        seasonNumber?: number;
        episodeNumber?: number;
        // Playlist info for auto-creation if needed
        playlistName?: string;
        playlistType?: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';
        serverUrl?: string;
        portalUrl?: string;
        macAddress?: string;
    }) => ipcRenderer.invoke('DOWNLOADS_START', data),
    downloadsCancel: (downloadId: number) =>
        ipcRenderer.invoke('DOWNLOADS_CANCEL', downloadId),
    downloadsRetry: (downloadId: number, downloadFolder: string) =>
        ipcRenderer.invoke('DOWNLOADS_RETRY', downloadId, downloadFolder),
    downloadsRemove: (downloadId: number) =>
        ipcRenderer.invoke('DOWNLOADS_REMOVE', downloadId),
    downloadsGetList: (playlistId?: string) =>
        ipcRenderer.invoke('DOWNLOADS_GET_LIST', playlistId),
    downloadsGet: (downloadId: number) =>
        ipcRenderer.invoke('DOWNLOADS_GET', downloadId),
    downloadsGetDefaultFolder: () =>
        ipcRenderer.invoke('DOWNLOADS_GET_DEFAULT_FOLDER'),
    downloadsSelectFolder: () => ipcRenderer.invoke('DOWNLOADS_SELECT_FOLDER'),
    downloadsRevealFile: (filePath: string) =>
        ipcRenderer.invoke('DOWNLOADS_REVEAL_FILE', filePath),
    downloadsPlayFile: (filePath: string) =>
        ipcRenderer.invoke('DOWNLOADS_PLAY_FILE', filePath),
    downloadsClearCompleted: (playlistId?: string) =>
        ipcRenderer.invoke('DOWNLOADS_CLEAR_COMPLETED', playlistId),
    onDownloadsUpdate: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('DOWNLOADS_UPDATE_EVENT', handler);
        return () => ipcRenderer.off('DOWNLOADS_UPDATE_EVENT', handler);
    },
});
