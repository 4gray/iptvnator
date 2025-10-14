import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Params } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { DataService } from '@iptvnator/services';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import * as PlaylistActions from 'm3u-state';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import {
    ERROR,
    Playlist,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
    STALKER_REQUEST,
    XTREAM_REQUEST,
    XTREAM_RESPONSE,
} from 'shared-interfaces';
import { AppConfig } from '../../environments/environment';

@Injectable({
    providedIn: 'root',
})
export class PwaService extends DataService {
    private readonly http = inject(HttpClient);
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly swUpdate = inject(SwUpdate);
    private readonly translateService = inject(TranslateService);

    /** Proxy URL to avoid CORS issues */
    corsProxyUrl = AppConfig.BACKEND_URL;

    constructor() {
        super();
        console.log('PWA service initialized...');
    }

    /** Uses service worker mechanism to check for available application updates */
    checkUpdates() {
        this.swUpdate.versionUpdates.subscribe(() => {
            this.snackBar
                .open(
                    this.translateService.instant('UPDATE_AVAILABLE'),
                    this.translateService.instant('REFRESH')
                )
                .onAction()
                .subscribe(() => {
                    window.location.reload();
                });
        });
    }

    getAppVersion(): string {
        return AppConfig.version;
    }

    /**
     * Handles incoming IPC commands
     * @param type ipc command type
     * @param payload payload
     */
    sendIpcEvent(type: string, payload?: unknown) {
        if (type === PLAYLIST_PARSE_BY_URL) {
            this.fetchFromUrl(payload);
        } else if (type === PLAYLIST_UPDATE) {
            this.refreshPlaylist(payload);
        } else if (type === XTREAM_REQUEST) {
            return this.forwardXtreamRequest(
                payload as { url: string; params: Record<string, string> }
            );
        } else if (type === STALKER_REQUEST) {
            return this.forwardStalkerRequest(
                payload as {
                    url: string;
                    macAddress: string;
                    params: Record<string, string>;
                }
            );
        } else {
            return Promise.resolve();
        }
    }

    refreshPlaylist(payload: Partial<Playlist & { id: string }>) {
        this.getPlaylistFromUrl(payload.url)
            .pipe(
                catchError((error) => {
                    window.postMessage({
                        type: ERROR,
                    });
                    return throwError(() => error);
                })
            )
            .subscribe((playlist: Playlist) => {
                this.store.dispatch(
                    PlaylistActions.updatePlaylist({
                        playlist,
                        playlistId: payload.id,
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

    /**
     * Fetches playlist from the specified url
     * @param payload playlist payload
     */
    fetchFromUrl(payload: Partial<Playlist>): void {
        this.getPlaylistFromUrl(payload.url)
            .pipe(
                catchError((error) => {
                    window.postMessage({
                        type: ERROR,
                        message: this.getErrorMessageByStatusCode(error.status),
                        status: error.status,
                    });
                    return throwError(() => error);
                })
            )
            .subscribe((response: any) => {
                window.postMessage({
                    type: PLAYLIST_PARSE_RESPONSE,
                    payload: { ...response, isTemporary: payload.isTemporary },
                });
            });
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
        macAddress?: string;
    }) {
        const headers = payload.macAddress
            ? {
                  headers: {
                      Cookie: `mac=${payload.macAddress}`,
                  },
              }
            : {};
        try {
            let result: any;
            const response = await firstValueFrom(
                this.http.get(`${this.corsProxyUrl}/xtream`, {
                    params: {
                        url: payload.url,
                        ...payload.params,
                    },
                    ...headers,
                })
            );

            if (!(response as any).payload) {
                if (payload.params.action === 'get_account_info') return;

                result = {
                    type: ERROR,
                    status: (response as any).status,
                    message: (response as any).message ?? 'Unknown error',
                };
                window.postMessage(result);
            } else {
                result = {
                    type: XTREAM_RESPONSE,
                    payload: (response as any).payload,
                    action: payload.params.action,
                };
                window.postMessage(result);
            }
            return result;
        } catch (error: any) {
            if (payload.params.action === 'get_account_info') return;
            window.postMessage({
                type: ERROR,
                status: error.error?.status,
                message: error.error?.message ?? 'Unknown error',
            });
        }
    }

    async forwardStalkerRequest(payload: {
        url: string;
        params: Record<string, string>;
        macAddress: string;
    }) {
        try {
            // Build the query parameters
            const params = new URLSearchParams({
                url: payload.url,
                ...payload.params,
                macAddress: payload.macAddress,
            });

            // Make the fetch request
            const response = await fetch(
                `${this.corsProxyUrl}/stalker?${params.toString()}`
            );

            if (!response.ok) {
                throw new Error(
                    `Error: ${response.statusText} (Status: ${response.status})`
                );
            }

            // Parse and return the JSON response
            return (await response.json()).payload;
        } catch (err) {
            console.error('Stalker request error:', err);
            window.postMessage({
                type: ERROR,
                message: err.message ?? 'Error: not found',
                status: err.status ?? 404,
            });
            throw err;
        }
    }

    getPlaylistFromUrl(url: string) {
        return this.http.get(`${this.corsProxyUrl}/parse`, {
            params: { url },
        });
    }

    removeAllListeners(): void {
        // not implemented
    }

    listenOn(_command: string, callback: (...args: any[]) => void): void {
        window.addEventListener('message', callback);
    }

    getAppEnvironment(): string {
        return 'pwa';
    }

    fetchData(url: string, queryParams: Params) {
        // not implemented
    }
}
