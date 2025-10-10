import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    platform: process.platform,
    fetchPlaylistByUrl: (url: string) =>
        ipcRenderer.invoke('fetch-playlist-by-url', url),
});
