import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
    // Remote control channel change listener
    onChannelChange: (callback: (data: { direction: 'up' | 'down' }) => void) => {
        ipcRenderer.on('CHANNEL_CHANGE', (_event, data) => callback(data));
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
        origin?: string
    ) =>
        ipcRenderer.invoke(
            'OPEN_MPV_PLAYER',
            url,
            title,
            userAgent,
            referer,
            origin
        ),
    openInVlc: (
        url: string,
        title: string,
        userAgent: string,
        referer?: string,
        origin?: string
    ) =>
        ipcRenderer.invoke(
            'OPEN_VLC_PLAYER',
            url,
            title,
            userAgent,
            referer,
            origin
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
    setMpvPlayerPath: (mpvPlayerPath: string) =>
        ipcRenderer.invoke('SET_MPV_PLAYER_PATH', mpvPlayerPath),
    setVlcPlayerPath: (vlcPlayerPath: string) =>
        ipcRenderer.invoke('SET_VLC_PLAYER_PATH', vlcPlayerPath),
    updateSettings: (settings: any) =>
        ipcRenderer.invoke('SETTINGS_UPDATE', settings),
    stalkerRequest: (payload: {
        url: string;
        macAddress: string;
        params: Record<string, string>;
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
    dbSaveCategories: (playlistId: string, categories: any[], type: string) =>
        ipcRenderer.invoke('DB_SAVE_CATEGORIES', playlistId, categories, type),
    dbHasContent: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_HAS_CONTENT', playlistId, type),
    dbGetContent: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_GET_CONTENT', playlistId, type),
    dbSaveContent: (playlistId: string, streams: any[], type: string) =>
        ipcRenderer.invoke('DB_SAVE_CONTENT', playlistId, streams, type),
    dbSearchContent: (
        playlistId: string,
        searchTerm: string,
        types: string[]
    ) => ipcRenderer.invoke('DB_SEARCH_CONTENT', playlistId, searchTerm, types),
    dbGlobalSearch: (searchTerm: string, types: string[]) =>
        ipcRenderer.invoke('DB_GLOBAL_SEARCH', searchTerm, types),
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
});
