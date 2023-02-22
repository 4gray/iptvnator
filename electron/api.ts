import axios from 'axios';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { parse } from 'iptv-playlist-parser';
import {
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
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
} from '../shared/ipc-commands';
import { createPlaylistObject } from '../shared/playlist.utils';
import { ParsedPlaylist } from '../src/typings.d';

const fs = require('fs');
const https = require('https');

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
                (event, args: { userAgent: string; referer?: string }) => {
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
            .on(MIGRATE_PLAYLISTS, (event) => {
                this.getAllPlaylists().then((playlists) => {
                    event.sender.send(MIGRATE_PLAYLISTS_RESPONSE, {
                        payload: playlists,
                    });
                });
            })
            .on(DELETE_ALL_PLAYLISTS, (event) => {
                this.removeAllPlaylists(event);
            });

        // listeners for EPG events
        ipcMain
            .on(EPG_GET_PROGRAM, (event, arg) =>
                this.workerWindow.webContents.send(EPG_GET_PROGRAM, arg)
            )
            .on(EPG_GET_CHANNELS, (event, arg) =>
                this.workerWindow.webContents.send(EPG_GET_CHANNELS, arg)
            )
            .on(EPG_GET_CHANNELS_DONE, (event, arg) =>
                this.mainWindow.webContents.send(EPG_GET_CHANNELS_DONE, arg)
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
            )
            .on(EPG_GET_CHANNELS_BY_RANGE, (event, arg) => {
                this.workerWindow.webContents.send(
                    EPG_GET_CHANNELS_BY_RANGE,
                    arg
                );
            })
            .on(EPG_GET_CHANNELS_BY_RANGE_RESPONSE, (event, arg) =>
                this.mainWindow.webContents.send(
                    EPG_GET_CHANNELS_BY_RANGE_RESPONSE,
                    arg
                )
            )
            .on(EPG_FORCE_FETCH, (event, arg) =>
                this.workerWindow.webContents.send(EPG_FORCE_FETCH, arg)
            );

        // this.refreshPlaylists();
    }

    /**
     * Starts the update process for all the playlists with the enabled auto-refresh flag
     */
    // TODO: implement the same mechanism for self-hosted PWAs (ignore vercel instance)
    /* refreshPlaylists(): void {
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
    } */

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
     * @param event ipc event to send the response back to the renderer
     */
    handlePlaylistRefresh(
        args: { id: string; title: string; filePath?: string; url?: string },
        playlistString: string,
        event?: Electron.IpcMainEvent
    ) {
        if (event) {
            const parsedPlaylist: ParsedPlaylist =
                this.parsePlaylist(playlistString);
            const playlist = createPlaylistObject(
                args.title,
                parsedPlaylist,
                args.url ? args.url : args.filePath,
                args.url ? 'URL' : 'FILE'
            );
            event.sender.send(PLAYLIST_UPDATE_RESPONSE, {
                message: `Success! The playlist was successfully updated (${parsedPlaylist.items.length} channels)`,
                playlist: {
                    ...playlist,
                    _id: args.id,
                },
            });
        }
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
    ): Promise<void> {
        if (!args.url) return;
        try {
            await axios
                .get(args.url, { httpsAgent: agent })
                .then((result) =>
                    this.handlePlaylistRefresh(args, result.data, event)
                );
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
    fetchPlaylistByFilePath(
        args: { id: string; title: string; filePath?: string },
        event?: Electron.IpcMainEvent
    ): void {
        if (!args.filePath) return;
        try {
            fs.readFile(args.filePath, 'utf-8', (err, data) => {
                if (err) {
                    this.handleFileNotFoundError(err, event);
                    return;
                }

                this.handlePlaylistRefresh(args, data, event);
            });
        } catch (err) {
            this.handleFileNotFoundError(err, event);
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
    removeAllPlaylists(event: Electron.IpcMainEvent) {
        fs.unlink(dbPath, (err) => {
            if (err && err.code == 'ENOENT') {
                // file doesn't exist
                console.info("File doesn't exist, won't remove it.");
            } else if (err) {
                console.error('Error occurred while trying to remove file');
            } else {
                console.log(`${dbPath} was deleted`);
                event.sender.send(IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE, {
                    result: false,
                });
            }
        });
    }
}
