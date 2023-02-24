import { HttpClient } from '@angular/common/http';
import { ApplicationRef, inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import {
    ERROR,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
} from '../../../shared/ipc-commands';
import { Playlist } from '../../../shared/playlist.interface';
import { AppConfig } from '../../environments/environment';
import * as PlaylistActions from '../state/actions';
import { DataService } from './data.service';
import { PlaylistsService } from './playlists.service';

@Injectable({
    providedIn: 'root',
})
export class PwaService extends DataService {
    appRef = inject(ApplicationRef);
    playlistService = inject(PlaylistsService);
    snackBar = inject(MatSnackBar);
    store = inject(Store);
    swUpdate = inject(SwUpdate);
    translateService = inject(TranslateService);

    /** Proxy URL to avoid CORS issues */
    corsProxyUrl = AppConfig.BACKEND_URL;

    constructor(private http: HttpClient) {
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
    sendIpcEvent(type: string, payload?: unknown): void {
        if (type === PLAYLIST_PARSE_BY_URL) {
            this.fetchFromUrl(payload);
        } else if (type === PLAYLIST_UPDATE) {
            this.refreshPlaylist(payload);
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

    getPlaylistFromUrl(url: string) {
        return this.http.get(`${this.corsProxyUrl}/parse`, {
            params: { url },
        });
    }

    removeAllListeners(): void {
        // not implemented
    }

    listenOn(command: string, callback: (...args: any[]) => void): void {
        window.addEventListener('message', callback);
    }
}
