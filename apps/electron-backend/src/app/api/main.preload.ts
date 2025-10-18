import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    platform: process.platform,
    fetchPlaylistByUrl: (url: string, title?: string) =>
        ipcRenderer.invoke('fetch-playlist-by-url', url, title),
    updatePlaylistFromFilePath: (filePath: string, title: string) =>
        ipcRenderer.invoke('update-playlist-from-file-path', filePath, title),
    openPlaylistFromFile: () => ipcRenderer.invoke('open-playlist-from-file'),
    setUserAgent: (userAgent: string, referer?: string) =>
        ipcRenderer.invoke('set-user-agent', userAgent, referer),
    openInMpv: (
        url: string,
        path: string,
        title: string,
        userAgent: string,
        referer?: string,
        origin?: string
    ) =>
        ipcRenderer.invoke(
            'OPEN_MPV_PLAYER',
            url,
            path,
            title,
            userAgent,
            referer,
            origin
        ),
    openInVlc: (
        url: string,
        path: string,
        title: string,
        userAgent: string,
        referer?: string,
        origin?: string
    ) =>
        ipcRenderer.invoke(
            'OPEN_VLC_PLAYER',
            url,
            path,
            title,
            userAgent,
            referer,
            origin
        ),
    autoUpdatePlaylists: (playlists) =>
        ipcRenderer.invoke('AUTO_UPDATE_PLAYLISTS', playlists),
    fetchEpg: (urls: string[]) =>
        ipcRenderer.invoke('FETCH_EPG', { url: urls }),
    getChannelPrograms: (channelId: string) =>
        ipcRenderer.invoke('GET_CHANNEL_PROGRAMS', { channelId }),
    setMpvPlayerPath: (mpvPlayerPath: string) =>
        ipcRenderer.invoke('SET_MPV_PLAYER_PATH', mpvPlayerPath),
    setVlcPlayerPath: (vlcPlayerPath: string) =>
        ipcRenderer.invoke('SET_VLC_PLAYER_PATH', vlcPlayerPath),
    updateSettings: (settings: any) =>
        ipcRenderer.invoke('SETTINGS_UPDATE', settings),
});
