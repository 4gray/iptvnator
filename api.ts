/* eslint-disable @typescript-eslint/no-misused-promises */
import { app, BrowserWindow, ipcMain } from 'electron';
import { parse } from 'iptv-playlist-parser';
import axios from 'axios';
import { guid } from '@datorama/akita';
import { Playlist } from './src/app/home/playlist.interface';
import Nedb from 'nedb-promises-ts';
import {
    EPG_ERROR,
    EPG_FETCH,
    EPG_FETCH_DONE,
    EPG_GET_PROGRAM,
    EPG_GET_PROGRAM_DONE,
    PLAYLIST_SAVE_DETAILS,
} from './ipc-commands';

const fs = require('fs');
const userData = app.getPath('userData');
const db = new Nedb<Playlist>({
    filename: `${userData}/db/data.db`,
    autoload: true,
});

export class Api {
    /** Instance of the main application window */
    mainWindow: BrowserWindow;

    /** Default user agent stored as a fallback value */
    defaultUserAgent: string;

    /** Instance of the epg browser window */
    workerWindow: BrowserWindow;

    constructor() {
        ipcMain.on('parse-playlist-by-url', async (event, args) => {
            try {
                await axios.get(args.url).then((result) => {
                    const array = result.data.split('\n');
                    const parsedPlaylist = this.parsePlaylist(array);
                    const playlistObject = this.createPlaylistObject(
                        args.title,
                        parsedPlaylist,
                        args.url
                    );
                    this.insertToDb(playlistObject);
                    event.sender.send('parse-response', {
                        payload: playlistObject,
                    });
                });
            } catch (err) {
                event.sender.send('error', {
                    message: err.response.statusText,
                    status: err.response.status,
                });
            }
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

        ipcMain.on('playlists-all', (event) => this.sendAllPlaylists(event));

        ipcMain.on('playlist-by-id', async (event, args) => {
            const playlist = await db.findOne({ _id: args.id });
            this.setUserAgent(playlist.userAgent);
            event.sender.send('parse-response', {
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

        // open playlist from file system
        ipcMain.on('open-file', (event, args) => {
            fs.readFile(args.filePath, 'utf-8', (err, data) => {
                if (err) {
                    console.log(
                        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                        'An error ocurred reading the file :' + err.message
                    );
                    return;
                }
                const array = (data as string).split('\n');
                const parsedPlaylist = this.parsePlaylist(array);
                const playlistObject = this.createPlaylistObject(
                    args.fileName,
                    parsedPlaylist
                );
                this.insertToDb(playlistObject);
                event.sender.send('parse-response', {
                    payload: playlistObject,
                });
            });
        });

        ipcMain.on('update-favorites', async (event, args) => {
            const updated = await db.update(
                { id: args.id },
                { $set: { favorites: args.favorites } }
            );
            if (!updated.numAffected || updated.numAffected === 0) {
                console.error('Error: Favorites were not updated');
            }
        });

        // listeners for EPG events
        ipcMain
            .on(EPG_GET_PROGRAM, (event, arg) =>
                this.workerWindow.webContents.send(EPG_GET_PROGRAM, arg)
            )
            .on(EPG_GET_PROGRAM_DONE, (event, arg) => {
                this.mainWindow.webContents.send(EPG_GET_PROGRAM_DONE, arg);
            })
            .on(EPG_FETCH, (event, arg) =>
                this.workerWindow.webContents.send(EPG_FETCH, arg?.url)
            )
            .on(EPG_FETCH_DONE, (event, arg) =>
                this.mainWindow.webContents.send(EPG_FETCH_DONE, arg)
            )
            .on(EPG_ERROR, (event, arg) =>
                this.mainWindow.webContents.send(EPG_ERROR, arg)
            );

        ipcMain.on(PLAYLIST_SAVE_DETAILS, async (event, args) => {
            const updated = await db.update(
                { _id: args._id },
                { $set: { title: args.title, userAgent: args.userAgent } }
            );
            if (!updated.numAffected || updated.numAffected === 0) {
                console.error('Error: Playlist details were not updated');
            }
            this.sendAllPlaylists(event);
        });
    }

    /**
     * Sends list with all playlists which are stored in the database
     * @param event main event
     */
    async sendAllPlaylists(event: Electron.IpcMainEvent): Promise<void> {
        const playlists = await db.find(
            { type: { $exists: false } },
            {
                count: 1,
                title: 1,
                _id: 1,
                url: 1,
                importDate: 1,
                userAgent: 1,
                filename: 1,
            }
        );
        event.sender.send('playlist-all-result', {
            payload: playlists,
        });
    }

    /**
     * Sets the user agent header for all http requests
     * @param userAgent user agent to use
     */
    setUserAgent(userAgent: string): void {
        if (userAgent === undefined || userAgent === null || userAgent === '') {
            userAgent = this.defaultUserAgent;
        }
        this.mainWindow.webContents.setUserAgent(userAgent);
        console.log(`Success: Set "${userAgent}" as user agent header`);
    }

    /**
     * Sets epg browser window
     * @param workerWindow
     */
    setEpgWorkerWindow(workerWindow: BrowserWindow): void {
        this.workerWindow = workerWindow;

        // store default user agent as fallback
        this.defaultUserAgent = this.workerWindow.webContents.getUserAgent();
    }

    /**
     * Sets browser window of the main app window
     * @param mainWindow
     */
    setMainWindow(mainWindow: BrowserWindow): void {
        this.mainWindow = mainWindow;
    }

    /**
     * Saves playlist to the localStorage
     * @param name name of the playlist
     * @param playlist playlist to save
     * @param url url of the playlist
     */
    createPlaylistObject(name: string, playlist: any, url?: string): Playlist {
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
            ...(url ? { url } : {}),
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
    insertToDb(playlist: any): void {
        db.insert(playlist).then((response) => {
            console.log('playlist was saved...', response._id);
        });
    }
}
