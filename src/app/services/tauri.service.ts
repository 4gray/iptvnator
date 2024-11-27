import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { parse } from 'iptv-playlist-parser';
import {
    EPG_GET_PROGRAM_DONE,
    ERROR,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    XTREAM_RESPONSE,
} from '../../../shared/ipc-commands';
import { Playlist } from '../../../shared/playlist.interface';
import { createPlaylistObject } from '../../../shared/playlist.utils';
import { AppConfig } from '../../environments/environment';
import { DataService } from './data.service';

@Injectable({
    providedIn: 'root',
})
export class TauriService extends DataService {
    constructor() {
        super();
        console.log('Tauri service initialized...');
    }

    getAppVersion(): string {
        return AppConfig.version;
    }

    async sendIpcEvent(type: string, payload?: unknown) {
        if (type === PLAYLIST_PARSE_BY_URL) {
            this.fetchFromUrl(payload);
        } else if (type === 'PLAYLIST_UPDATE') {
            console.log('PLAYLIST_UPDATE');
        } else if (type === 'XTREAM_REQUEST') {
            this.forwardXtreamRequest(
                payload as { url: string; params: Record<string, string> }
            );
        } else if (type === 'STALKER_REQUEST') {
            console.log('STALKER_REQUEST');
            this.fetchStalkerData(
                payload as {
                    url: string;
                    macAddress: string;
                    params: Record<string, string>;
                }
            );
        } else if (type === 'OPEN_MPV_PLAYER') {
            return invoke('open_in_mpv', {
                url: (payload as any).url,
                path: (payload as any).mpvPlayerPath || '',
            }).catch((error) => {
                window.postMessage({
                    type: ERROR,
                    message: `Error launching MPV: ${error}`,
                });
                throw error;
            });
        } else if (type === 'OPEN_VLC_PLAYER') {
            return invoke('open_in_vlc', {
                url: (payload as any).url,
                path: (payload as any).vlcPlayerPath || '',
            }).catch((error) => {
                window.postMessage({
                    type: ERROR,
                    message: `Error launching VLC: ${error}`,
                });
                throw error;
            });
        } else if (type === 'EPG_FETCH_DONE') {
            window.postMessage({
                type: EPG_GET_PROGRAM_DONE,
                payload,
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
            console.log(payload);
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

            const result = await response.json();
            console.log(result);
            window.postMessage({
                type: 'STALKER_RESPONSE',
                payload: result,
                action: payload.params.action,
            });
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

            const playlist = createPlaylistObject(
                'tests',
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
        const url = new URL(`${payload.url}/player_api.php`);
        Object.entries(payload.params).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });

        const response = await fetch(url.toString());

        const responseBody = await response.json();
        if (!responseBody) {
            window.postMessage({
                type: ERROR,
                status: response.status,
                message: responseBody.message ?? 'Unknown error',
            });
        } else {
            window.postMessage({
                type: XTREAM_RESPONSE,
                payload: responseBody,
                action: payload.params.action,
            });
        }
    }

    removeAllListeners(type: string): void {
        console.error(
            'Method not implemented. Following type was provided:',
            type
        );
    }

    listenOn(command: string, callback: (...args: any[]) => void): void {
        window.addEventListener('message', callback);
    }

    getAppEnvironment(): string {
        return 'tauri';
    }
}
