import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Params } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import * as PlaylistActions from 'm3u-state';
import { DataService } from 'services';
import {
    AUTO_UPDATE_PLAYLISTS,
    ERROR,
    Playlist,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_UPDATE,
    XTREAM_RESPONSE,
} from 'shared-interfaces';
import { AppConfig } from '../../environments/environment';

@Injectable({
    providedIn: 'root',
})
export class ElectronService extends DataService {
    private eventListeners: { [key: string]: () => void } = {};
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translateService = inject(TranslateService);

    constructor() {
        super();
        console.log('Electron service initialized...');
    }

    getAppVersion(): string {
        return AppConfig.version;
    }

    async sendIpcEvent(type: string, payload?: unknown) {
        if (type === PLAYLIST_PARSE_BY_URL) {
            this.fetchM3uPlaylistFromUrl(payload);
        } else if (type === PLAYLIST_UPDATE) {
            this.updateM3uPlaylistFromFile(
                payload as {
                    id: string;
                    filePath?: string;
                    url?: string;
                    title: string;
                }
            );
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
                return await window.electron.openInMpv(
                    data.url,
                    data.title ?? '',
                    data['user-agent'] ?? undefined,
                    data.referer ?? undefined,
                    data.origin ?? undefined
                );
                /* thumbnail: data.thumbnail ?? '', */
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
                this.snackBar.open(`Error launching MPV: ${errorMessage}`, 'Close', {
                    duration: 5000,
                });
                console.error('MPV launch error:', error);
                throw error;
            }
        } else if (type === 'OPEN_VLC_PLAYER') {
            const data = payload as any;
            try {
                return await window.electron.openInVlc(
                    data.url,
                    data.title ?? '',
                    data['user-agent'] ?? undefined,
                    data.referer ?? undefined,
                    data.origin ?? undefined
                );
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
                this.snackBar.open(`Error launching VLC: ${errorMessage}`, 'Close', {
                    duration: 5000,
                });
                console.error('VLC launch error:', error);
                throw error;
            }
        } else if (type === AUTO_UPDATE_PLAYLISTS) {
            const data = payload as Playlist[];
            const playlists = await window.electron.autoUpdatePlaylists(data);
            this.store.dispatch(
                PlaylistActions.updateManyPlaylists({
                    playlists,
                })
            );
            this.snackBar.open(
                this.translateService.instant(
                    'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_SUCCESS'
                ),
                null,
                { duration: 2000 }
            );
        } else {
            console.log('Unknown type', type);
        }
    }

    private async fetchStalkerData(payload: {
        url: string;
        macAddress: string;
        params: Record<string, string>;
    }) {
        try {
            // Use Electron IPC to make the Stalker request
            const response = await window.electron.stalkerRequest(payload);
            return response;
        } catch (err) {
            console.error('Stalker request error:', err);
            this.snackBar.open(
                `Error: ${err.message ?? ' Not found'}, status: ${err.status ?? 404}`,
                'Close',
                {
                    duration: 5000,
                }
            );
            throw err;
        }
    }

    private async fetchM3uPlaylistFromUrl(payload: Partial<Playlist>) {
        window.electron.fetchPlaylistByUrl(payload.url).then((result) => {
            this.store.dispatch(
                PlaylistActions.handleAddingPlaylistByUrl({
                    isTemporary: !!payload?.isTemporary,
                    playlist: result,
                })
            );
        });
    }

    private async updateM3uPlaylistFromFile(data: {
        id: string;
        url?: string;
        filePath?: string;
        title: string;
    }) {
        let methodToCall = null;
        if (data.url && !data.filePath) {
            // fetch from url
            methodToCall = window.electron.fetchPlaylistByUrl(
                data.url,
                data.title
            );
        } else if (data.filePath && !data.url) {
            // update from file path
            methodToCall = window.electron.updatePlaylistFromFilePath(
                data.filePath,
                data.title
            );
        } else {
            console.error(
                'Either url or filePath must be provided, but not both.'
            );
            return;
        }

        methodToCall.then((playlistObject) => {
            this.store.dispatch(
                PlaylistActions.updatePlaylist({
                    playlist: {
                        ...playlistObject,
                        _id: data.id,
                    },
                    playlistId: data.id,
                })
            );

            this.snackBar.open(
                this.translateService.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                null,
                { duration: 2000 }
            );
        });
    }

    /* private getErrorMessageByStatusCode(status: number) {
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
    } */

    private async forwardXtreamRequest(payload: {
        url: string;
        params: Record<string, string>;
    }) {
        try {
            // Use Electron IPC to make the Xtream request
            const response = await window.electron.xtreamRequest(payload);

            const result = {
                type: XTREAM_RESPONSE,
                payload: response.payload,
                action: response.action,
            };
            window.postMessage(result);
            return result;
        } catch (error: any) {
            console.error('Xtream request error:', error.message);
            this.snackBar.open(
                `Error: ${error.message ?? 'Failed to connect to Xtream server'}, status: ${
                    error.status ?? 500
                }`,
                'Close',
                {
                    duration: 5000,
                }
            );
            return {
                type: ERROR,
                status: error.status ?? 500,
                message: error.message ?? 'Failed to connect to Xtream server',
            };
        }
    }

    removeAllListeners(type: string): void {
        if (type === 'all') {
            // Unsubscribe from all event listeners
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
        window.removeEventListener('message', this.getListenerForCommand(type));
    }

    private getListenerForCommand(command: string): any {
        // This is a placeholder. In a real implementation, you would need to
        // store the actual listener functions to be able to remove them
        return () => {};
    }

    listenOn(command: string, callback: (...args: any[]) => void): void {
        // For Electron, use window message events
        window.addEventListener('message', callback);
    }

    getAppEnvironment(): string {
        return 'electron';
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

        const result = await response.json();
        return result;
    }
}
