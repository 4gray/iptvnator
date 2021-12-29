import { Injectable } from '@angular/core';
import {
    PLAYLIST_PARSE,
    PLAYLIST_PARSE_RESPONSE,
} from '../../../shared/ipc-commands';
import { ParsedPlaylist } from '../../typings';
import { DataService } from './data.service';
import { parse } from 'iptv-playlist-parser';
import { guid } from '@datorama/akita';
import { Playlist } from '../../../shared/playlist.interface';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { Observable } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class PwaService extends DataService {
    playlists$: Observable<Playlist[]> =
        this.dbService.getAll<Playlist>('playlists');

    constructor(private dbService: NgxIndexedDBService) {
        super();
        console.log('PWA Service');
    }

    getAppVersion(): string {
        return '1.0.0';
        //throw new Error('Method not implemented.');
    }

    sendIpcEvent(type: string, payload?: any): void {
        console.log(type, payload);

        if (type === PLAYLIST_PARSE) {
            const parsedPlaylist = this.parsePlaylist(payload.playlist);
            const playlistObject = this.createPlaylistObject(
                payload.title,
                parsedPlaylist,
                payload.path,
                'FILE'
            );

            // save to db
            this.dbService.add('playlists', playlistObject).subscribe((key) => {
                console.log('key: ', key);
            });

            window.postMessage({
                type: PLAYLIST_PARSE_RESPONSE,
                payload: playlistObject,
            });
        } else if (type === 'playlist-by-id') {
            this.dbService
                .getByIndex('playlists', '_id', payload.id)
                .subscribe((playlist) => {
                    window.postMessage({
                        type: PLAYLIST_PARSE_RESPONSE,
                        payload: playlist,
                    });
                });
        }
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
        return {
            id: guid(),
            _id: guid(),
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

    removeAllListeners(type: string) {
        console.log(type + ' listeners removed');
    }

    listenOn(command: string, callback: (...args: any[]) => void): void {
        console.log('listen on ' + command);
        window.addEventListener('message', callback);
    }
}
