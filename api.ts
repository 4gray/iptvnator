import { app, ipcMain } from 'electron';
import { parse } from 'iptv-playlist-parser';
import axios from 'axios';
import { guid } from '@datorama/akita';
import { Playlist } from './src/app/playlist-uploader/playlist.interface';
import Nedb from 'nedb-promises-ts';

const join = require('path').join;
const openAboutWindow = require('about-window').default;
const userData = app.getPath('userData');
const db = new Nedb<Playlist>({
    filename: `${userData}/db/data.db`,
    autoload: true,
});

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

        ipcMain.on('playlists-all', async (event, args) => {
            const playlists = await db.find({}, { count: 1, title: 1, _id: 1 });
            event.sender.send('playlist-all-result', {
                payload: playlists,
            });
        });

        ipcMain.on('playlist-by-id', async (event, args) => {
            const playlist = await db.findOne({ _id: args.id });
            event.sender.send('playlist-by-id-result', {
                payload: playlist,
            });
        });

        ipcMain.on('playlist-remove-by-id', async (event, args) => {
            const removed = await db.remove({ _id: args.id });
            if (removed) {
                event.sender.send('playlist-remove-by-id-result', {
                    message: 'playlist was removed',
                });
            }
        });

        ipcMain.on('show-about', () => {
            openAboutWindow({
                icon_path: join(__dirname, 'dist/assets/icons/icon.png'),
                copyright: 'Copyright (c) 2020 4gray',
                package_json_dir: __dirname,
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
        db.insert(playlist).then((response) => {
            console.log('playlist was saved...', response._id);
        });
    }
}
