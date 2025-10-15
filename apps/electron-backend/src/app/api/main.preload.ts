import { contextBridge, ipcRenderer } from 'electron';
import { AUTO_UPDATE_PLAYLISTS, Playlist } from 'shared-interfaces';

contextBridge.exposeInMainWorld('electron', {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    platform: process.platform,
    fetchPlaylistByUrl: (url: string, title?: string) =>
        ipcRenderer.invoke('fetch-playlist-by-url', url, title),
    updatePlaylistFromFilePath: (filePath: string, title: string) =>
        ipcRenderer.invoke('update-playlist-from-file-path', filePath, title),
    openPlaylistFromFile: () => ipcRenderer.invoke('open-playlist-from-file'),
    setUserAgent: (userAgent: string, referer?: string) =>
        ipcRenderer.send('set-user-agent', userAgent, referer),
    openInMpv: (
        url: string,
        path: string,
        title: string,
        userAgent: string,
        referer?: string,
        origin?: string
    ) =>
        ipcRenderer.send(
            'open-in-mpv',
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
        ipcRenderer.send(
            'open-in-vlc',
            url,
            path,
            title,
            userAgent,
            referer,
            origin
        ),
    autoUpdatePlaylists: (playlists: Playlist[]) =>
        ipcRenderer.send(AUTO_UPDATE_PLAYLISTS, playlists),
});
