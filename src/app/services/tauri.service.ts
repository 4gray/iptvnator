import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Params } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { parse } from 'iptv-playlist-parser';
import {
    AUTO_UPDATE_PLAYLISTS,
    AUTO_UPDATE_PLAYLISTS_RESPONSE,
    EPG_GET_PROGRAM_DONE,
    ERROR,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
    XTREAM_RESPONSE,
} from '../../../shared/ipc-commands';
import { Playlist } from '../../../shared/playlist.interface';
import { createPlaylistObject, getFilenameFromUrl } from '../../../shared/playlist.utils';
import { AppConfig } from '../../environments/environment';
import { DataService } from './data.service';

@Injectable({
    providedIn: 'root',
})
export class TauriService extends DataService {
    private eventListeners: { [key: string]: () => void } = {};
    private snackBar = inject(MatSnackBar);

    constructor() {
        super();
        console.log('Tauri service initialized...');
        this.setupEventListeners();
    }

    private async setupEventListeners() {
        // Listen for player errors
        this.eventListeners['player-error'] = await listen(
            'player-error',
            (event) => {
                console.error('Player error:', event);
                this.snackBar.open(
                    `Player Error: ${event.payload as string}`,
                    'Close',
                    { duration: 5000 }
                );
            }
        );
    }

    getAppVersion(): string {
        return AppConfig.version;
    }

    async sendIpcEvent(type: string, payload?: unknown) {
        if (type === PLAYLIST_PARSE_BY_URL) {
            this.fetchFromUrl(payload);
        } else if (type === PLAYLIST_UPDATE) {
            const data = payload as {
                id: string;
                filePath: string;
                title: string;
            };
            const playlist = await readTextFile(data.filePath);
            const parsedPlaylist = parse(playlist);
            const playlistObject = createPlaylistObject(
                data.title,
                parsedPlaylist,
                data.filePath,
                'FILE'
            );

            window.postMessage({
                type: PLAYLIST_UPDATE_RESPONSE,
                payload: {
                    message: 'Success! The playlist was successfully updated',
                    playlist: {
                        ...playlistObject,
                        _id: data.id,
                    },
                },
            });
        } else if (type === 'XTREAM_REQUEST') {
            return await this.forwardXtreamRequest(
                payload as { url: string; params: Record<string, string> }
            );
        } else if (type === 'STALKER_REQUEST') {
            return this.fetchStalkerData(
                payload as {
                    url: string;
                    macAddress: string;
                    params: Record<string, string>;
                }
            );
        } else if (type === 'OPEN_MPV_PLAYER') {
            const data = payload as any;
            try {
                return await invoke('open_in_mpv', {
                    url: data.url,
                    path: data.mpvPlayerPath || '',
                    title: data.title ?? '',
                    thumbnail: data.thumbnail ?? '',
                    userAgent: data['user-agent'] ?? undefined,
                    referer: data.referer ?? undefined,
                    origin: data.origin ?? undefined,
                });
            } catch (error) {
                this.snackBar.open(`Error launching MPV: ${error}`, 'Close', {
                    duration: 5000,
                });
                console.error('MPV launch error:', error);
                throw error;
            }
        } else if (type === 'OPEN_VLC_PLAYER') {
            const data = payload as any;
            try {
                return await invoke('open_in_vlc', {
                    url: data.url,
                    path: data.vlcPlayerPath || '',
                    userAgent: data['user-agent'] ?? undefined,
                    referer: data.referer ?? undefined,
                    origin: data.origin ?? undefined,
                });
            } catch (error) {
                this.snackBar.open(`Error launching VLC: ${error}`, 'Close', {
                    duration: 5000,
                });
                console.error('VLC launch error:', error);
                throw error;
            }
        } else if (type === 'EPG_FETCH_DONE') {
            window.postMessage({
                type: EPG_GET_PROGRAM_DONE,
                payload,
            });
        } else if (type === AUTO_UPDATE_PLAYLISTS) {
            const playlists = [];
            const data = payload as Playlist[];

            for await (const item of data) {
                if (item.filePath) {
                    const playlist = await readTextFile(item.filePath);
                    const parsedPlaylist = parse(playlist);
                    const playlistObject = createPlaylistObject(
                        item.title,
                        parsedPlaylist,
                        item.filePath,
                        'FILE'
                    );
                    playlists.push({ ...playlistObject, _id: item._id });
                }
            }
            window.postMessage({
                type: AUTO_UPDATE_PLAYLISTS_RESPONSE,
                payload: {
                    message: 'Success! The playlists were successfully updated',
                    playlists,
                },
            });
        } else {
            console.log('Unknown type', type);
        }
    }

    async fetchStalkerData(payload: {
        url: string;
        macAddress: string;
        params: Record<string, string>;
    }) {
        try {
            const url = new URL(payload.url);

            Object.entries(payload.params).forEach(([key, value]) => {
                url.searchParams.append(key, value);
            });

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    Cookie: `mac=${payload.macAddress}`,
                },
            });

            if (!response.ok) {
                throw new Error(
                    `Error: ${response.statusText} (Status: ${response.status})`
                );
            }

            return await response.json();
            /* window.postMessage({
                type: 'STALKER_RESPONSE',
                payload: result,
                action: payload.params.action,
            }); */
        } catch (err) {
            console.log(err);
            window.postMessage({
                type: ERROR,
                message: err.message ?? 'Error: not found',
                status: err.status ?? 404,
            });
        }
    }

    async fetchFromUrl(payload: Partial<Playlist>) {
        try {
            const response = await fetch(payload.url);
            const responseBody = await response.text();
            const parsedPlaylist = parse(responseBody);

            // Extract playlist name from URL, use "Imported from URL" as fallback
            const extractedName = payload.url && payload.url.length > 1 
                ? getFilenameFromUrl(payload.url)
                : '';
            const playlistName = !extractedName || extractedName === 'Untitled playlist' 
                ? 'Imported from URL' 
                : extractedName;

            const playlist = createPlaylistObject(
                playlistName,
                parsedPlaylist,
                payload.url,
                'URL'
            );

            window.postMessage({
                type: PLAYLIST_PARSE_RESPONSE,
                payload: { ...playlist, isTemporary: payload.isTemporary },
            });
        } catch (error) {
            window.postMessage({
                type: ERROR,
                message: this.getErrorMessageByStatusCode(error.status),
                status: error.status,
            });
        }
    }

    getErrorMessageByStatusCode(status: number) {
        let message = 'Something went wrong';
        switch (status) {
            case 0:
                message = 'The backend is not reachable';
                break;
            case 413:
                message =
                    'This file is too big. Use standalone or self-hosted version of the app.';
                break;
            default:
                break;
        }
        return message;
    }

    async forwardXtreamRequest(payload: {
        url: string;
        params: Record<string, string>;
    }) {
        let result: any;
        const url = new URL(`${payload.url}/player_api.php`);
        Object.entries(payload.params).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });

        const response = await fetch(url.toString());

        const responseBody = await response.json();
        if (!responseBody) {
            result = {
                type: ERROR,
                status: response.status,
                message: responseBody.message ?? 'Unknown error',
            };
            window.postMessage(result);
        } else {
            result = {
                type: XTREAM_RESPONSE,
                payload: responseBody,
                action: payload.params.action,
            };
            window.postMessage(result);
        }
        return result;
    }

    removeAllListeners(type: string): void {
        if (type === 'all') {
            // Unsubscribe from all Tauri events
            Object.values(this.eventListeners).forEach((unsubscribe) =>
                unsubscribe()
            );
            this.eventListeners = {};
        } else if (this.eventListeners[type]) {
            // Unsubscribe from a specific event
            this.eventListeners[type]();
            delete this.eventListeners[type];
        }

        // Also remove any window message listeners
        // Note: This is a bit crude, but works for simple cases
        window.removeEventListener('message', this.getListenerForCommand(type));
    }

    private getListenerForCommand(command: string): any {
        // This is a placeholder. In a real implementation, you would need to
        // store the actual listener functions to be able to remove them
        return () => {};
    }

    listenOn(command: string, callback: (...args: any[]) => void): void {
        if (command.startsWith('tauri:')) {
            // For Tauri specific events, use the Tauri event system
            const tauriEvent = command.replace('tauri:', '');
            listen(tauriEvent, callback).then((unsubscribe) => {
                this.eventListeners[command] = unsubscribe;
            });
        } else {
            // For backward compatibility, use window messages
            window.addEventListener('message', callback);
        }
    }

    getAppEnvironment(): string {
        return 'tauri';
    }

    async fetchData(url: string, queryParams: Params) {
        const urlObject = new URL(url);
        Object.entries(queryParams).forEach(([key, value]) => {
            urlObject.searchParams.append(key, value);
        });
        const response = await fetch(urlObject.toString());
        if (!response.ok) {
            throw new Error(
                `Error: ${response.statusText} (Status: ${response.status})`
            );
        }

        console.log(url, queryParams);
        const result = await response.json();
        return result;
    }
}
