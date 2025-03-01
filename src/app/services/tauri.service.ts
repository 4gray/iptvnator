import { Injectable } from '@angular/core';
import { Params } from '@angular/router';
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
            return await this.forwardXtreamRequest(
                payload as { url: string; params: Record<string, string> }
            );
        } else if (type === 'STALKER_REQUEST') {
            this.fetchStalkerData(
                payload as {
                    url: string;
                    macAddress: string;
                    params: Record<string, string>;
                }
            );
        } else if (type === 'OPEN_MPV_PLAYER') {
            const data = payload as any;
            return invoke('open_in_mpv', {
                url: data.url,
                path: data.mpvPlayerPath || '',
                title: data.title ?? '',
                thumbnail: data.thumbnail ?? '',
                userAgent: data['user-agent'] ?? undefined,
                referer: data.referer ?? undefined,
                origin: data.origin ?? undefined,
            }).catch((error) => {
                window.postMessage({
                    type: ERROR,
                    message: `Error launching MPV: ${error}`,
                });
                throw error;
            });
        } else if (type === 'OPEN_VLC_PLAYER') {
            const data = payload as any;
            return invoke('open_in_vlc', {
                url: data.url,
                path: data.vlcPlayerPath || '',
                userAgent: data['user-agent'] ?? undefined,
                referer: data.referer ?? undefined,
                origin: data.origin ?? undefined,
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
