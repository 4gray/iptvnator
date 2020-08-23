import { ipcMain } from 'electron';
import { parse } from 'iptv-playlist-parser';
import axios from 'axios';
import { guid } from '@datorama/akita';
import { Playlist } from './src/app/playlist-uploader/playlist.interface';

const Datastore = require('nedb');
const db = new Datastore({ filename: 'data.db', autoload: true });

export class Api {
    constructor() {
        ipcMain.on('parse-playlist-by-url', (event, args) => {
            axios.get(args.url).then((result) => {
                const array = result.data.split('\n');
                const parsedPlaylist = this.parsePlaylist(array);
                const playlistObject = this.createPlaylistObject(
                    args.title,
                    parsedPlaylist
                );
                this.insertToDb(playlistObject);
                event.sender.send('parse-url-response', {
                    payload: playlistObject,
                });
            });
        });

        ipcMain.on('parse-playlist', (event, args) => {
            const parsedPlaylist = this.parsePlaylist(args.playlist);
            const playlistObject = this.createPlaylistObject(
                args.title,
                parsedPlaylist
            );
            this.insertToDb(playlistObject);
            event.sender.send('parse-response', { payload: playlistObject });
        });

        ipcMain.on('playlists-all', (event, args) => {
            db.find({}, { count: 1, title: 1, _id: 1 }, function (
                err,
                playlists
            ) {
                event.sender.send('playlist-all-result', {
                    payload: playlists,
                });
            });
        });

        ipcMain.on('playlist-by-id', (event, args) => {
            db.findOne({ _id: args.id }, function (err, playlist) {
                event.sender.send('playlist-by-id-result', {
                    payload: playlist,
                });
            });
        });

        ipcMain.on('playlist-remove-by-id', (event, args) => {
            db.remove({ _id: args.id }, function (err, playlist) {
                event.sender.send('playlist-remove-by-id-result', {
                    message: 'playlist was removed',
                });
            });
        });
    }

    /**
     * Saves playlist to the localStorage
     * @param name name of the playlist
     * @param playlist playlist to save
     */
    createPlaylistObject(name: string, playlist: any): Playlist {
        return {
            id: guid(),
            _id: guid(),
            filename: name,
            title: name,
            count: playlist.items.length,
            playlist,
            importDate: new Date().getMilliseconds(),
            lastUsage: new Date().getMilliseconds(),
            favorites: [],
        };
    }

    /**
     * Parses string based array to playlist object
     * @param m3uArray m3u playlist as array with strings
     */
    parsePlaylist(m3uArray: any[]): any {
        const playlistAsString = m3uArray.join('\n');
        return parse(playlistAsString);
    }

    /**
     * Inserts new playlist to the database
     * @param playlist playlist to add
     */
    insertToDb(playlist) {
        db.insert(playlist, function (err, newrec) {
            console.log('playlist was saved...', newrec._id);
        });
    }
}
