import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Params } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import { DataService } from 'services';
import {
    AUTO_UPDATE_PLAYLISTS,
    ERROR,
    Playlist,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_UPDATE,
    XtreamCodeActions,
    XTREAM_RESPONSE,
    XTREAM_REQUEST,
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
    private readonly silentXtreamActions = new Set<string>([
        XtreamCodeActions.GetAccountInfo,
        XtreamCodeActions.GetLiveCategories,
        XtreamCodeActions.GetVodCategories,
        XtreamCodeActions.GetSeriesCategories,
    ]);

    constructor() {
        super();
        console.log('Electron service initialized...');
        this.setupPlayerErrorListener();
    }

    private setupPlayerErrorListener() {
        // Listen for player errors from the backend
        if (window.electron?.onPlayerError) {
            window.electron.onPlayerError(
                (data: {
                    player: string;
                    error: string;
                    originalError: string;
                }) => {
                    console.error(`${data.player} Error:`, data.originalError);
                    this.snackBar.open(
                        `${data.player} Error: ${data.error}`,
                        'Close',
                        {
                            duration: 7000,
                            panelClass: ['error-snackbar'],
                        }
                    );
                }
            );
        }
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
        } else if (type === XTREAM_REQUEST) {
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
                    data.origin ?? undefined,
                    data.contentInfo,
                    data.startTime
                );
                /* thumbnail: data.thumbnail ?? '', */
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
                this.snackBar.open(
                    `Error launching MPV: ${errorMessage}`,
                    'Close',
                    {
                        duration: 5000,
                    }
                );
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
                    data.origin ?? undefined,
                    data.contentInfo,
                    data.startTime
                );
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
                this.snackBar.open(
                    `Error launching VLC: ${errorMessage}`,
                    'Close',
                    {
                        duration: 5000,
                    }
                );
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
            const action = payload.params?.action;
            const isSilentAction = action
                ? this.silentXtreamActions.has(action)
                : false;
            const normalizedMessage = this.getReadableXtreamErrorMessage(error);

            // Log error to console
            if (isSilentAction) {
                console.log(
                    `Background Xtream action failed (${action ?? 'unknown'}):`,
                    normalizedMessage
                );
            } else {
                console.error('Xtream request error:', normalizedMessage);
            }

            // Only show snackbar for user-triggered Xtream requests
            if (!isSilentAction) {
                this.snackBar.open(
                    `Xtream request failed: ${normalizedMessage}`,
                    'Close',
                    {
                        duration: 5000,
                    }
                );
            }

            return {
                type: ERROR,
                status: error.status ?? 500,
                message: normalizedMessage,
            };
        }
    }

    private getReadableXtreamErrorMessage(error: unknown): string {
        const fallback = 'Failed to connect to Xtream server';
        if (!error) {
            return fallback;
        }

        const maybeError = error as {
            message?: unknown;
            statusText?: unknown;
            status?: unknown;
            error?: unknown;
        };

        if (typeof maybeError.message === 'string') {
            if (maybeError.message.includes('[object Object]')) {
                if (typeof maybeError.error === 'string') {
                    return maybeError.error;
                }
                if (
                    maybeError.error &&
                    typeof maybeError.error === 'object' &&
                    'message' in (maybeError.error as Record<string, unknown>) &&
                    typeof (maybeError.error as Record<string, unknown>).message ===
                        'string'
                ) {
                    return (maybeError.error as Record<string, string>).message;
                }
                return fallback;
            }
            return maybeError.message;
        }

        if (typeof maybeError.statusText === 'string') {
            return maybeError.statusText;
        }

        if (typeof error === 'string') {
            return error;
        }

        return fallback;
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
}
