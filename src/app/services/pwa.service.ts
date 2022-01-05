import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { guid } from '@datorama/akita';
import { parse } from 'iptv-playlist-parser';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { switchMap } from 'rxjs';
import {
    PLAYLIST_GET_ALL,
    PLAYLIST_GET_ALL_RESPONSE,
    PLAYLIST_GET_BY_ID,
    PLAYLIST_PARSE,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_REMOVE_BY_ID,
    PLAYLIST_REMOVE_BY_ID_RESPONSE,
    PLAYLIST_SAVE_DETAILS,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_FAVORITES,
} from '../../../shared/ipc-commands';
import {
    Playlist,
    PlaylistUpdateState,
} from '../../../shared/playlist.interface';
import { AppConfig } from '../../environments/environment';
import { ParsedPlaylist } from '../../typings';
import { DbStores } from '../indexed-db.config';
import { DataService } from './data.service';

@Injectable({
    providedIn: 'root',
})
export class PwaService extends DataService {
    /**
     * Creates an instance of PwaService.
     * @param dbService database service
     * @param http angular http client
     */
    constructor(
        private dbService: NgxIndexedDBService,
        private http: HttpClient
    ) {
        super();
        console.log('PWA service initialized...');
    }

    /**
     * Returns the current version of the app
     */
    getAppVersion(): string {
        return AppConfig.version;
    }

    /**
     * Handles incoming IPC commands
     * @param type ipc command type
     * @param payload payload
     */
    sendIpcEvent(type: string, payload?: any): void {
        if (type === PLAYLIST_PARSE) {
            const parsedPlaylist = this.parsePlaylist(payload.playlist);
            const playlistObject = this.createPlaylistObject(
                payload.title,
                parsedPlaylist,
                payload.path,
                'FILE'
            );

            // save to db
            this.dbService
                .add(DbStores.Playlists, playlistObject)
                .subscribe(() => {
                    console.log('playlist was saved to db...');
                });

            window.postMessage({
                type: PLAYLIST_PARSE_RESPONSE,
                payload: playlistObject,
            });
        } else if (type === PLAYLIST_GET_BY_ID) {
            this.dbService
                .getByIndex(DbStores.Playlists, '_id', payload.id)
                .subscribe((playlist) => {
                    window.postMessage({
                        type: PLAYLIST_PARSE_RESPONSE,
                        payload: playlist,
                    });
                });
        } else if (type === PLAYLIST_REMOVE_BY_ID) {
            this.dbService
                .delete(DbStores.Playlists, payload.id)
                .subscribe((playlist) => {
                    window.postMessage({
                        type: PLAYLIST_REMOVE_BY_ID_RESPONSE,
                        payload: playlist,
                    });
                });
        } else if (type === PLAYLIST_GET_ALL) {
            this.dbService.getAll(DbStores.Playlists).subscribe((playlists) => {
                window.postMessage({
                    type: PLAYLIST_GET_ALL_RESPONSE,
                    payload: playlists,
                });
            });
        } else if (type === PLAYLIST_SAVE_DETAILS) {
            this.dbService
                .getByID(DbStores.Playlists, payload._id)
                .pipe(
                    switchMap((playlist: Playlist) => {
                        return this.dbService.update(DbStores.Playlists, {
                            ...playlist,
                            title: payload.title,
                        });
                    })
                )
                .subscribe((playlists) => {
                    window.postMessage({
                        type: PLAYLIST_GET_ALL_RESPONSE,
                        payload: playlists,
                    });
                });
        } else if (type === PLAYLIST_UPDATE_FAVORITES) {
            this.dbService
                .getByID(DbStores.Playlists, payload.id)
                .pipe(
                    switchMap((playlist: Playlist) => {
                        return this.dbService.update(DbStores.Playlists, {
                            ...playlist,
                            favorites: payload.favorites,
                        });
                    })
                )
                .subscribe(() => {
                    console.log('favorites were updated...');
                });
        } else if (type === PLAYLIST_PARSE_BY_URL) {
            this.fetchFromUrl(payload);
        } else if (type === PLAYLIST_UPDATE) {
            this.http
                .get(payload.url, { responseType: 'text' })
                .subscribe((response: any) => {
                    const refreshedPlaylist =
                        this.convertFileStringToPlaylist(response);

                    this.dbService
                        .getByID(DbStores.Playlists, payload.id)
                        .pipe(
                            switchMap((currentPlaylist: Playlist) => {
                                return this.dbService.update(
                                    DbStores.Playlists,
                                    {
                                        ...currentPlaylist,
                                        ...refreshedPlaylist,
                                        count: refreshedPlaylist.items.length,
                                        updateDate: Date.now(),
                                        updateState:
                                            PlaylistUpdateState.UPDATED,
                                    }
                                );
                            })
                        )
                        .subscribe((playlists) => {
                            console.log('playlist was updated...');
                            window.postMessage({
                                type: PLAYLIST_GET_ALL_RESPONSE,
                                payload: playlists,
                            });
                        });
                });
        }
    }

    /**
     * Fetches playlist from the specified url
     * @param payload playlist payload
     */
    fetchFromUrl(payload: Partial<Playlist>): void {
        this.http
            .get(payload.url, { responseType: 'text' })
            .subscribe((response: any) => {
                const parsedPlaylist =
                    this.convertFileStringToPlaylist(response);
                const playlistObject = this.createPlaylistObject(
                    payload.title,
                    parsedPlaylist,
                    payload.url,
                    'URL'
                );

                // save to db
                this.dbService
                    .add(DbStores.Playlists, playlistObject)
                    .subscribe(() => {
                        console.log('playlist was added...');
                    });

                window.postMessage({
                    type: PLAYLIST_PARSE_RESPONSE,
                    payload: playlistObject,
                });
            });
    }

    /**
     * Converts file string to playlist object
     * @param m3uString
     */
    convertFileStringToPlaylist(m3uString: string): ParsedPlaylist {
        return this.parsePlaylist(m3uString.split('\n'));
    }

    /**
     * Saves playlist to the localStorage
     * @param name name of the playlist
     * @param playlist playlist to save
     * @param urlOrPath absolute fs path or url of the playlist
     * @param uploadType upload type - by file or via an url
     */
    createPlaylistObject(
        name: string,
        playlist: ParsedPlaylist,
        urlOrPath?: string,
        uploadType?: 'URL' | 'FILE'
    ): Playlist {
        const id = guid();
        return {
            id,
            _id: id,
            filename: name,
            title: name,
            count: playlist.items.length,
            playlist: {
                ...playlist,
                items: playlist.items.map((item) => ({
                    id: guid(),
                    ...item,
                })),
            },
            importDate: new Date().toISOString(),
            lastUsage: new Date().toISOString(),
            favorites: [],
            autoRefresh: false,
            ...(uploadType === 'URL' ? { url: urlOrPath } : {}),
            ...(uploadType === 'FILE' ? { filePath: urlOrPath } : {}),
        };
    }

    /**
     * Parses string based array to playlist object
     * @param m3uArray m3u playlist as array with strings
     */
    parsePlaylist(m3uArray: string[]): ParsedPlaylist {
        const playlistAsString = m3uArray.join('\n');
        return parse(playlistAsString);
    }

    removeAllListeners(): void {
        // not implemented
    }

    listenOn(command: string, callback: (...args: any[]) => void): void {
        window.addEventListener('message', callback);
    }
}
