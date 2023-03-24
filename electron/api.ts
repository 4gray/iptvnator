import axios from 'axios';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { promises as fsPromises } from 'fs';
import { parse } from 'iptv-playlist-parser';
import { Channel } from '../shared/channel.interface';
import {
    AUTO_UPDATE_PLAYLISTS,
    AUTO_UPDATE_PLAYLISTS_RESPONSE,
    CHANNEL_SET_USER_AGENT,
    DELETE_ALL_PLAYLISTS,
    EPG_ERROR,
    EPG_FETCH,
    EPG_FETCH_DONE,
    EPG_FORCE_FETCH,
    EPG_GET_CHANNELS,
    EPG_GET_CHANNELS_BY_RANGE,
    EPG_GET_CHANNELS_BY_RANGE_RESPONSE,
    EPG_GET_CHANNELS_DONE,
    EPG_GET_PROGRAM,
    EPG_GET_PROGRAM_DONE,
    ERROR,
    IS_PLAYLISTS_MIGRATION_POSSIBLE,
    IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE,
    MIGRATE_PLAYLISTS,
    MIGRATE_PLAYLISTS_RESPONSE,
    OPEN_FILE,
    OPEN_MPV_PLAYER,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
} from '../shared/ipc-commands';
import { Playlist } from '../shared/playlist.interface';
import { createPlaylistObject } from '../shared/playlist.utils';
import { ParsedPlaylist } from '../src/typings.d';

const fs = require('fs');
const https = require('https');

const mpvAPI = require('node-mpv');
const createMpvInstance = () => new mpvAPI({}, ['--autofit=70%']);
let mpv = createMpvInstance();
mpv.on('quit', () => (mpv = null)).on('crash', () => (mpv = null));

/** @deprecated - used only for migration */
const Nedb = require('nedb-promises');

/** @deprecated - used only for migration */
const userData = process.env['e2e']
    ? process.cwd() + '/e2e'
    : app.getPath('userData');

/** @deprecated - used only for migration */
const dbPath = `${userData}/db/data.db`;
/** @deprecated - used only for migration */
const db = new Nedb({
    filename: dbPath,
    autoload: true,
});

const agent = new https.Agent({
    rejectUnauthorized: false,
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
        ipcMain
            .on(PLAYLIST_PARSE_BY_URL, (event, args) => {
                try {
                    axios
                        .get(args.url, { httpsAgent: agent })
                        .then((result) => {
                            const parsedPlaylist = this.parsePlaylist(
                                result.data
                            );
                            const playlistObject = createPlaylistObject(
                                args.title,
                                parsedPlaylist,
                                args.url,
                                'URL'
                            );
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
            })
            .on(OPEN_FILE, (event, args) => {
                fs.readFile(
                    args.filePath,
                    'utf-8',
                    (err: NodeJS.ErrnoException, data: string) => {
                        if (err) {
                            console.log(
                                'An error ocurred reading the file :' +
                                    err.message
                            );
                            return;
                        }

                        const parsedPlaylist = this.parsePlaylist(data);
                        const playlistObject = createPlaylistObject(
                            args.fileName,
                            parsedPlaylist,
                            args.filePath,
                            'FILE'
                        );

                        event.sender.send(PLAYLIST_PARSE_RESPONSE, {
                            payload: playlistObject,
                        });
                    }
                );
            })
            .on(
                PLAYLIST_UPDATE,
                (
                    event,
                    args: {
                        id: string;
                        title: string;
                        filePath?: string;
                        url?: string;
                    }
                ) => {
                    if (args.filePath && args.id) {
                        this.fetchPlaylistByFilePath(args, event);
                    } else if (args.url && args.id) {
                        this.fetchPlaylistByUrl(args, event);
                    }
                }
            )
            .on(
                CHANNEL_SET_USER_AGENT,
                (_event, args: { userAgent: string; referer?: string }) => {
                    if (args.userAgent && args.referer) {
                        this.setUserAgent(args.userAgent, args.referer);
                    } else {
                        this.setUserAgent(this.defaultUserAgent, 'localhost');
                    }
                }
            )
            .on(IS_PLAYLISTS_MIGRATION_POSSIBLE, (event) => {
                db.count({
                    type: { $exists: false },
                }).then((count: number) => {
                    event.sender.send(
                        IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE,
                        {
                            result: count > 0,
                            message:
                                count > 0
                                    ? `${count} playlists were found, which can be migrated from the database used in the last version of the application.`
                                    : 'No playlists for migration',
                        }
                    );
                });
            })
            .on(
                AUTO_UPDATE_PLAYLISTS,
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                async (event, playlists: Partial<Playlist>[]) => {
                    const results: any[] = [];
                    let playlist: any;
                    for (const element of playlists) {
                        if (element.url && element._id) {
                            playlist = await this.fetchPlaylistByUrl({
                                id: element._id,
                                title: element.title || '',
                                url: element.url,
                            });
                            results.push(playlist);
                        } else if (element.filePath && element._id) {
                            playlist = await this.fetchPlaylistByFilePath({
                                id: element._id,
                                title: element.title || '',
                                filePath: element.filePath,
                            });
                            results.push(playlist);
                        }
                    }
                    event.sender.send(
                        AUTO_UPDATE_PLAYLISTS_RESPONSE,
                        results.filter((item) => item !== undefined)
                    );
                }
            )
            .on(MIGRATE_PLAYLISTS, (event) => {
                this.getAllPlaylists().then((playlists) => {
                    event.sender.send(MIGRATE_PLAYLISTS_RESPONSE, {
                        payload: playlists,
                    });
                });
            })
            .on(DELETE_ALL_PLAYLISTS, (event) => {
                this.removeAllPlaylists(event);
            })
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            .on(OPEN_MPV_PLAYER, async (event, { url }) => {
                try {
                    if (mpv === null) {
                        mpv = createMpvInstance();
                    }
                    if (mpv.isRunning()) {
                        await mpv.load(url);
                    } else {
                        await mpv.start();
                        await mpv.load(url);
                    }
                } catch (error) {
                    console.log(error);
                    event.sender.send(ERROR, {
                        message:
                            'Error: Something went wrong. Make sure that mpv player is installed on your system.',
                    });
                }
            });

        // listeners for EPG events
        ipcMain
            .on(EPG_GET_PROGRAM, (_event, arg) =>
                this.workerWindow.webContents.send(EPG_GET_PROGRAM, arg)
            )
            .on(EPG_GET_CHANNELS, (_event, arg) =>
                this.workerWindow.webContents.send(EPG_GET_CHANNELS, arg)
            )
            .on(EPG_GET_CHANNELS_DONE, (_event, arg) =>
                this.mainWindow.webContents.send(EPG_GET_CHANNELS_DONE, arg)
            )
            .on(EPG_GET_PROGRAM_DONE, (_event, arg) => {
                this.mainWindow.webContents.send(EPG_GET_PROGRAM_DONE, arg);
            })
            .on(EPG_FETCH, (_event, arg) =>
                this.workerWindow.webContents.send(EPG_FETCH, arg?.url)
            )
            .on(EPG_FETCH_DONE, (_event, arg) =>
                this.mainWindow.webContents.send(EPG_FETCH_DONE, arg)
            )
            .on(EPG_ERROR, (_event, arg) =>
                this.mainWindow.webContents.send(EPG_ERROR, arg)
            )
            .on(EPG_GET_CHANNELS_BY_RANGE, (_event, arg) => {
                this.workerWindow.webContents.send(
                    EPG_GET_CHANNELS_BY_RANGE,
                    arg
                );
            })
            .on(EPG_GET_CHANNELS_BY_RANGE_RESPONSE, (_event, arg) =>
                this.mainWindow.webContents.send(
                    EPG_GET_CHANNELS_BY_RANGE_RESPONSE,
                    arg
                )
            )
            .on(EPG_FORCE_FETCH, (_event, arg) =>
                this.workerWindow.webContents.send(EPG_FORCE_FETCH, arg)
            );

        this.setTitleBarListeners();
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
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                details.requestHeaders['Referer'] = referer as string;
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
     * Converts the fetched playlist string to the playlist object, updates it  in the database and sends the updated playlists array back to the renderer
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     */
    getRefreshedPlaylist(
        args: { id: string; title: string; filePath?: string; url?: string },
        playlistString: string
    ) {
        const parsedPlaylist: ParsedPlaylist =
            this.parsePlaylist(playlistString);
        const playlist = createPlaylistObject(
            args.title,
            parsedPlaylist,
            args.url ? args.url : args.filePath,
            args.url ? 'URL' : 'FILE'
        );
        return {
            ...playlist,
            _id: args.id,
        };
    }

    sendPlaylistRefreshResponse(
        playlistId: string,
        playlist: Playlist,
        event: Electron.IpcMainEvent
    ) {
        event.sender.send(PLAYLIST_UPDATE_RESPONSE, {
            message: `Success! The playlist was successfully updated (${
                (playlist.playlist.items as Channel[]).length
            } channels)`,
            playlist: {
                ...playlist,
                _id: playlistId,
            },
        });
    }

    /**
     * Set default listeners for custom-titlebar
     */
    setTitleBarListeners() {
        ipcMain.on('window-minimize', function (event) {
            BrowserWindow.fromWebContents(event.sender).minimize();
        });

        ipcMain.on('window-maximize', function (event) {
            const window = BrowserWindow.fromWebContents(event.sender);
            window.isMaximized() ? window.unmaximize() : window.maximize();
        });

        ipcMain.on('window-close', function (event) {
            BrowserWindow.fromWebContents(event.sender).close();
        });

        ipcMain.on('window-is-maximized', function (event) {
            event.returnValue = BrowserWindow.fromWebContents(
                event.sender
            ).isMaximized();
        });
    }

    /**
     * Fetches the playlist from the given url and triggers the update operation
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     * @param event ipc event to send the response back to the renderer
     */
    async fetchPlaylistByUrl(
        args: { id: string; title: string; url?: string },
        event?: Electron.IpcMainEvent
    ) {
        if (!args.url) return;
        try {
            const result = await axios.get(args.url, { httpsAgent: agent });

            const refreshedPlaylist = this.getRefreshedPlaylist(
                args,
                result.data
            );
            if (event) {
                this.sendPlaylistRefreshResponse(
                    refreshedPlaylist._id,
                    refreshedPlaylist,
                    event
                );
            } else {
                return refreshedPlaylist;
            }
        } catch (err) {
            if (event)
                event.sender.send(ERROR, {
                    message: `File not found. Please check the entered playlist URL again.`,
                    status: err.response?.status,
                });
        }
    }

    /**
     * Fetches the playlist from the given path from the file system and triggers the update operation
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     * @param event ipc event to send the response back to the renderer
     */
    async fetchPlaylistByFilePath(
        args: { id: string; title: string; filePath?: string },
        event?: Electron.IpcMainEvent
    ) {
        if (!args.filePath) return;
        let refreshedPlaylist: Playlist;

        try {
            const playlist = await fsPromises.readFile(args.filePath, 'utf-8');
            refreshedPlaylist = this.getRefreshedPlaylist(args, playlist);

            if (event) {
                this.sendPlaylistRefreshResponse(
                    refreshedPlaylist._id,
                    refreshedPlaylist,
                    event
                );
            } else {
                return refreshedPlaylist;
            }
        } catch (err) {
            return;
        }
    }

    /** Sends an error message to the renderer process */
    handleFileNotFoundError(
        error: {
            errno: string;
            code: string;
            syscall: string;
            path: string;
        },
        event?: Electron.IpcMainEvent
    ): void {
        console.error(error);
        if (event) {
            event.sender.send(ERROR, {
                message: `Sorry, playlist was not found (${error.path})`,
                status: 'ENOENT',
            });
        }
    }

    /**
     * Parses string based array to playlist object
     * @param m3uString m3u playlist as string
     */
    parsePlaylist(m3uString: string): ParsedPlaylist {
        return parse(m3uString);
    }

    /** @deprecated - used only for migration */
    getAllPlaylists() {
        return db
            .find({ type: { $exists: false } })
            .sort({ position: 1, importDate: -1 });
    }

    /** @deprecated - used only for migration */
    async removeAllPlaylists(event: Electron.IpcMainEvent) {
        const removeCount = await db.remove({}, { multi: true });
        console.info(removeCount, ' playlists were removed');
        fs.unlink(dbPath, (err) => {
            if (err && err.code == 'ENOENT') {
                console.info("File doesn't exist, won't remove it.");
            } else if (err) {
                console.error('Error occurred while trying to remove file');
            } else {
                console.info(`${dbPath} was deleted`);
                event.sender.send(IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE, {
                    result: false,
                });
            }
        });
    }
}
