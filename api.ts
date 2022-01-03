import { ParsedPlaylist } from './src/typings.d';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { parse } from 'iptv-playlist-parser';
import axios from 'axios';
import { guid } from '@datorama/akita';
import { Playlist, PlaylistUpdateState } from './shared/playlist.interface';
import Nedb, { Cursor } from 'nedb-promises-ts';
import {
    CHANNEL_SET_USER_AGENT,
    EPG_ERROR,
    EPG_FETCH,
    EPG_FETCH_DONE,
    EPG_GET_PROGRAM,
    EPG_GET_PROGRAM_DONE,
    ERROR,
    PLAYLIST_SAVE_DETAILS,
    PLAYLIST_PARSE,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
    PLAYLIST_UPDATE_POSITIONS,
    PLAYLIST_GET_ALL_RESPONSE,
    PLAYLIST_REMOVE_BY_ID_RESPONSE,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_GET_ALL,
    PLAYLIST_REMOVE_BY_ID,
    PLAYLIST_GET_BY_ID,
    OPEN_FILE,
    PLAYLIST_UPDATE_FAVORITES,
} from './shared/ipc-commands';

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

    /** Default referer url value */
    defaultReferer: string;

    /** Instance of the epg browser window */
    workerWindow: BrowserWindow;

    constructor() {
        ipcMain.on(PLAYLIST_PARSE_BY_URL, (event, args) => {
            try {
                axios.get(args.url).then((result) => {
                    const parsedPlaylist = this.convertFileStringToPlaylist(
                        result.data
                    );
                    const playlistObject = this.createPlaylistObject(
                        args.title,
                        parsedPlaylist,
                        args.url,
                        'URL'
                    );
                    this.insertToDb(playlistObject);
                    event.sender.send(PLAYLIST_PARSE_RESPONSE, {
                        payload: playlistObject,
                    });
                });
            } catch (err) {
                event.sender.send(ERROR, {
                    message: err.response.statusText,
                    status: err.response.status,
                });
            }
        });

        ipcMain.on(PLAYLIST_PARSE, (event, args) => {
            const parsedPlaylist = this.parsePlaylist(args.playlist);
            const playlistObject = this.createPlaylistObject(
                args.title,
                parsedPlaylist,
                args.path,
                'FILE'
            );
            this.insertToDb(playlistObject);
            event.sender.send(PLAYLIST_PARSE_RESPONSE, {
                payload: playlistObject,
            });
        });

        ipcMain.on(PLAYLIST_GET_ALL, (event) => this.sendAllPlaylists(event));

        ipcMain.on(PLAYLIST_GET_BY_ID, (event, args) => {
            db.findOne({ _id: args.id }).then((playlist) => {
                this.setUserAgent(playlist.userAgent);
                event.sender.send(PLAYLIST_PARSE_RESPONSE, {
                    payload: playlist,
                });
            });
        });

        ipcMain.on(PLAYLIST_REMOVE_BY_ID, (event, args) => {
            db.remove({ _id: args.id }).then((removed) => {
                if (removed) {
                    event.sender.send(PLAYLIST_REMOVE_BY_ID_RESPONSE, {
                        message: 'playlist was removed',
                    });
                }
            });
        });

        // open playlist from file system
        ipcMain.on(OPEN_FILE, (event, args) => {
            fs.readFile(
                args.filePath,
                'utf-8',
                (err: NodeJS.ErrnoException, data: string) => {
                    if (err) {
                        console.log(
                            'An error ocurred reading the file :' + err.message
                        );
                        return;
                    }

                    const parsedPlaylist =
                        this.convertFileStringToPlaylist(data);
                    const playlistObject = this.createPlaylistObject(
                        args.fileName,
                        parsedPlaylist,
                        args.filePath,
                        'FILE'
                    );
                    this.insertToDb(playlistObject);
                    event.sender.send(PLAYLIST_PARSE_RESPONSE, {
                        payload: playlistObject,
                    });
                }
            );
        });

        ipcMain.on(PLAYLIST_UPDATE_FAVORITES, (event, args) => {
            db.update(
                { id: args.id },
                { $set: { favorites: args.favorites } }
            ).then((updated) => {
                if (!updated.numAffected || updated.numAffected === 0) {
                    console.error('Error: Favorites were not updated');
                }
            });
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

        ipcMain.on(
            PLAYLIST_SAVE_DETAILS,
            (
                event,
                args: Pick<
                    Playlist,
                    '_id' | 'title' | 'userAgent' | 'autoRefresh'
                >
            ) => {
                this.updatePlaylistById(args._id, {
                    title: args.title,
                    userAgent: args.userAgent,
                    autoRefresh: args.autoRefresh,
                }).then((updated) => {
                    if (!updated.numAffected || updated.numAffected === 0) {
                        console.error(
                            'Error: Playlist details were not updated'
                        );
                    }
                    this.sendAllPlaylists(event);
                });
            }
        );

        ipcMain.on(
            PLAYLIST_UPDATE,
            (event, args: { id: string; filePath?: string; url?: string }) => {
                if (args.filePath && args.id) {
                    this.fetchPlaylistByFilePath(args.id, args.filePath, event);
                } else if (args.url && args.id) {
                    this.fetchPlaylistByUrl(args.id, args.url, event);
                }
            }
        );

        ipcMain.on(
            CHANNEL_SET_USER_AGENT,
            (event, args: { userAgent: string; referer?: string }) => {
                if (args.userAgent && args.referer) {
                    this.setUserAgent(args.userAgent, args.referer);
                } else {
                    this.setUserAgent(this.defaultUserAgent, 'localhost');
                }
            }
        );

        ipcMain.on(
            PLAYLIST_UPDATE_POSITIONS,
            (event, playlists: Partial<Playlist[]>) =>
                playlists.forEach((list, index) => {
                    this.updatePlaylistById(list._id, {
                        ...list,
                        position: index,
                    });
                })
        );

        this.refreshPlaylists();
    }

    /**
     * Starts the update process for all the playlists with the enabled auto-refresh flag
     */
    refreshPlaylists(): void {
        this.getAllPlaylistsMeta().then((playlists) => {
            playlists.forEach((playlist) => {
                if (playlist.autoRefresh && playlist.autoRefresh === true) {
                    if (playlist.url) {
                        this.fetchPlaylistByUrl(playlist._id, playlist.url);
                    } else if (playlist.filePath) {
                        this.fetchPlaylistByFilePath(
                            playlist._id,
                            playlist.filePath
                        );
                    } else {
                        console.log('skip...');
                    }
                }
            });
        });
    }

    /**
     * Sends list with all playlists which are stored in the database
     * @param event main event
     */
    sendAllPlaylists(event: Electron.IpcMainEvent): void {
        this.getAllPlaylistsMeta().then((playlists) => {
            event.sender.send(PLAYLIST_GET_ALL_RESPONSE, {
                payload: playlists,
            });
        });
    }

    /**
     * Returns all existing playlists with meta information from the database
     * @returns
     */
    getAllPlaylistsMeta(): Cursor<Playlist> {
        return db
            .find({ type: { $exists: false } })
            .projection({
                count: 1,
                title: 1,
                _id: 1,
                url: 1,
                importDate: 1,
                userAgent: 1,
                filename: 1,
                filePath: 1,
                autoRefresh: 1,
                updateDate: 1,
                updateState: 1,
                position: 1,
            })
            .sort({ position: 1, importDate: -1 });
    }

    /**
     * Sets the user agent header for all http requests
     * @param userAgent user agent to use
     * @param referer referer to use
     */
    setUserAgent(userAgent: string, referer?: string): void {
        if (userAgent === undefined || userAgent === null || userAgent === '') {
            userAgent = this.defaultUserAgent;
        }

        session.defaultSession.webRequest.onBeforeSendHeaders(
            (details, callback) => {
                details.requestHeaders['User-Agent'] = userAgent;
                details.requestHeaders['Referer'] = referer;
                callback({ requestHeaders: details.requestHeaders });
            }
        );
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
     * Creates a playlist object
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
     * Updates the provided playlist in the database
     * @param id id of the playlist
     * @param data playlist data to update
     * @returns
     */
    updatePlaylistById(
        id: string,
        data: Partial<Playlist>
    ): Promise<{
        numAffected: number;
        upsert: boolean;
    }> {
        return db.update(
            { _id: id },
            {
                $set: data,
            }
        );
    }

    /**
     * Converts the fetched playlist string to the playlist object, updates it  in the database and sends the updated playlists array back to the renderer
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     * @param event ipc event to send the response back to the renderer
     */
    async handlePlaylistRefresh(
        id: string,
        playlistString: string,
        event?: Electron.IpcMainEvent
    ): Promise<void> {
        const playlist: ParsedPlaylist =
            this.convertFileStringToPlaylist(playlistString);
        const updated = await this.updatePlaylistById(id, {
            playlist,
            count: playlist.items.length,
            updateDate: Date.now(),
            updateState: PlaylistUpdateState.UPDATED,
        });
        if (!updated.numAffected || updated.numAffected === 0) {
            console.error('Error: Playlist details were not updated');
        }

        if (event) {
            event.sender.send(PLAYLIST_UPDATE_RESPONSE, {
                message: `Success! The playlist was successfully updated (${playlist.items.length} channels)`,
            });

            // send all playlists back to the renderer process
            this.sendAllPlaylists(event);
        }
    }

    /**
     * Fetches the playlist from the given url and triggers the update operation
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     * @param event ipc event to send the response back to the renderer
     */
    async fetchPlaylistByUrl(
        id: string,
        url: string,
        event?: Electron.IpcMainEvent
    ): Promise<void> {
        try {
            await axios
                .get(url)
                .then((result) =>
                    this.handlePlaylistRefresh(id, result.data, event)
                );
        } catch (err) {
            this.updatePlaylistById(id, {
                updateState: PlaylistUpdateState.NOT_UPDATED,
            });
            event.sender.send(ERROR, {
                message: `File not found. Please check the entered playlist URL again.`,
                status: err.response.status,
            });
        }
    }

    /**
     * Fetches the playlist from the given path from the file system and triggers the update operation
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     * @param event ipc event to send the response back to the renderer
     */
    fetchPlaylistByFilePath(
        id: string,
        path: string,
        event?: Electron.IpcMainEvent
    ): void {
        try {
            fs.readFile(path, 'utf-8', (err, data) => {
                if (err) {
                    this.handleFileNotFoundError(err, id, event);
                    return;
                }

                this.handlePlaylistRefresh(id, data, event);
            });
        } catch (err) {
            this.handleFileNotFoundError(err, id, event);
        }
    }

    /**
     * Sends an error message to the renderer process
     * @param error
     * @param id
     * @param event
     */
    handleFileNotFoundError(
        error: {
            errno: string;
            code: string;
            syscall: string;
            path: string;
        },
        id: string,
        event?: Electron.IpcMainEvent
    ): void {
        console.error(error);
        this.updatePlaylistById(id, {
            updateState: PlaylistUpdateState.NOT_UPDATED,
        });
        if (event) {
            // send all playlists back to the renderer process
            this.sendAllPlaylists(event);
            event.sender.send(ERROR, {
                message: `Sorry, playlist was not found (${error.path})`,
                status: 'ENOENT',
            });
        }
    }

    convertFileStringToPlaylist(m3uString: string): ParsedPlaylist {
        return this.parsePlaylist(m3uString.split('\n'));
    }

    /**
     * Parses string based array to playlist object
     * @param m3uArray m3u playlist as array with strings
     */
    parsePlaylist(m3uArray: string[]): ParsedPlaylist {
        const playlistAsString = m3uArray.join('\n');
        return parse(playlistAsString);
    }

    /**
     * Inserts new playlist to the database
     * @param playlist playlist to add
     */
    insertToDb(playlist: Playlist): void {
        db.insert(playlist).then((response) => {
            console.log('playlist was saved...', response._id);
        });
    }
}
