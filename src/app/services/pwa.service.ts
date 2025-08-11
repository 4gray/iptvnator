import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Params } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { parse } from 'iptv-playlist-parser';
import { catchError, firstValueFrom, Observable, throwError } from 'rxjs';
import {
    ERROR,
    PLAYLIST_UPDATE,
    STALKER_REQUEST,
    STALKER_RESPONSE,
    XTREAM_REQUEST,
    XTREAM_RESPONSE
} from '../../../shared/ipc-commands';
import { Playlist, PlaylistUpdateState } from '../../../shared/playlist.interface';
import { AppConfig } from '../../environments/environment';
import * as PlaylistActions from '../state/actions';
import { DataService } from './data.service';

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
        if (type === PLAYLIST_UPDATE) {
            this.refreshPlaylist(payload);
        } else if (type === XTREAM_REQUEST) {
            return this.forwardXtreamRequest(
                payload as { url: string; params: Record<string, string> }
            );
        } else if (type === STALKER_REQUEST) {
            this.forwardStalkerRequest(
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
     * Fetch playlist from URL and parse it
     */
    getPlaylistFromUrl(url: string): Observable<Playlist> {
        return new Observable(observer => {
            this.http.get(url, { responseType: 'text' }).subscribe({
                next: (response: string) => {
                    try {
                        const parsedPlaylist = parse(response);
                        
                        if (parsedPlaylist.items && parsedPlaylist.items.length > 0) {
                            const playlist: Playlist = {
                                _id: Date.now().toString(),
                                title: 'Imported Playlist',
                                url: url,
                                count: parsedPlaylist.items.length,
                                updateDate: Date.now(),
                                updateState: PlaylistUpdateState.UPDATED,
                                playlist: {
                                    header: parsedPlaylist.header,
                                    items: parsedPlaylist.items
                                },
                                importDate: new Date().toISOString(),
                                lastUsage: new Date().toISOString(),
                                favorites: [],
                                autoRefresh: false,
                                userAgent: null,
                                serverUrl: null,
                                portalUrl: null,
                                macAddress: null,
                                username: null,
                                password: null
                            };
                            
                            observer.next(playlist);
                            observer.complete();
                        } else {
                            observer.error(new Error('No valid playlist items found'));
                        }
                    } catch (error) {
                        observer.error(new Error('Failed to parse playlist'));
                    }
                },
                error: (error) => {
                    observer.error(error);
                }
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
            case 451:
                message = 'Access blocked due to legal restrictions. This may be due to geographic location, ISP blocking, or server compliance requirements.';
                break;
            case 403:
                message = 'Access forbidden. Your IP address or location may be blocked by the server.';
                break;
            case 429:
                message = 'Too many requests. Please wait before trying again.';
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

    forwardStalkerRequest(payload: {
        url: string;
        params: Record<string, string>;
        macAddress: string;
    }) {
        return this.http
            .get(`${this.corsProxyUrl}/stalker`, {
                params: {
                    url: payload.url,
                    ...payload.params,
                    macAddress: payload.macAddress,
                },
            })
            .subscribe((response) => {
                window.postMessage({
                    type: STALKER_RESPONSE,
                    payload: (response as any).payload,
                    action: payload.params.action,
                });
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

    async fetchData(url: string, queryParams: Params) {
        try {
            const response = await firstValueFrom(
                this.http.get(`${this.corsProxyUrl}/xtream`, {
                    params: {
                        url: url,
                        ...queryParams,
                    },
                })
            );
            return response;
        } catch (error) {
            console.error('Error fetching data:', error);
            throw error;
        }
    }
}
