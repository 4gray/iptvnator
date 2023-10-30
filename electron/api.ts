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
    OPEN_VLC_PLAYER,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
    SET_MPV_PLAYER_PATH,
    SET_VLC_PLAYER_PATH,
    STALKER_REQUEST,
    STALKER_RESPONSE,
    XTREAM_REQUEST,
    XTREAM_RESPONSE,
} from '../shared/ipc-commands';
import { Playlist } from '../shared/playlist.interface';
import { createPlaylistObject } from '../shared/playlist.utils';
import { ParsedPlaylist } from '../src/typings.d';

const fs = require('fs');
const https = require('https');
const child_process = require('child_process');
const path = require('path');

const mpvAPI = require('node-mpv');

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

const MPV_PLAYER_PATH = 'MPV_PLAYER_PATH';
const VLC_PLAYER_PATH = 'VLC_PLAYER_PATH';

export class Api {
    /** Instance of the main application window */
    mainWindow: BrowserWindow;

    /** Default user agent stored as a fallback value */
    defaultUserAgent: string;

    /** Default referer url value */
    defaultReferer: string;

    /** Instance of the epg browser window */
    workerWindow: BrowserWindow;

    store;

    mpv;

    constructor(store) {
        this.store = store;
        this.mpv = this.createMpvInstance();
        this.mpv
            .on('quit', () => (this.mpv = null))
            .on('crash', () => (this.mpv = null));

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
                    if (args.userAgent && args.referer !== undefined) {
                        this.setUserAgent(
                            args.userAgent,
                            args.referer || 'localhost'
                        );
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
                    if (this.mpv === null) {
                        this.mpv = this.createMpvInstance();
                    }
                    if (this.mpv.isRunning()) {
                        await this.mpv.load(url);
                    } else {
                        await this.mpv.start();
                        await this.mpv.load(url);
                    }
                } catch (error) {
                    console.log(error);
                    event.sender.send(ERROR, {
                        message: `Error: ${
                            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                            error?.verbose ??
                            'Something went wrong. Make sure that mpv player is installed on your system.'
                        } `,
                    });
                }
            })
            .on(SET_MPV_PLAYER_PATH, (_event, mpvPlayerPath) => {
                console.log('... setting mpv player path', mpvPlayerPath);
                store.set(MPV_PLAYER_PATH, mpvPlayerPath);

                // recreate mpv player instance with new binary path if it was changed
                if (store.get(MPV_PLAYER_PATH, mpvPlayerPath) !== mpvPlayerPath)
                    this.mpv = this.createMpvInstance();
            })
            .on(OPEN_VLC_PLAYER, (event, { url }) => {
                const proc = child_process.spawn(
                    this.getVlcPath(),
                    [`"${url as string}"`],
                    {
                        shell: true,
                    }
                );

                proc.on('exit', (code) => {
                    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                    console.log(`VLC exited with code ${code}`);
                });
            })
            .on(SET_VLC_PLAYER_PATH, (_event, vlcPlayerPath) => {
                console.log('... setting vlc player path', vlcPlayerPath);
                store.set(VLC_PLAYER_PATH, vlcPlayerPath);
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

        ipcMain
            .on(
                XTREAM_REQUEST,
                (
                    event,
                    arg: { url: string; params: Record<string, string> }
                ) => {
                    const xtreamApiPath = '/player_api.php';

                    axios
                        .get(arg.url + xtreamApiPath, {
                            params: arg.params ?? {},
                        })
                        .then((result) => {
                            event.sender.send(XTREAM_RESPONSE, {
                                payload: result.data,
                                action: arg.params.action,
                            });
                        })
                        .catch((err) => {
                            event.sender.send(ERROR, {
                                message:
                                    err.response?.statusText ??
                                    'Error: not found',
                                status: err.response?.status ?? 404,
                            });
                        });
                }
            )
            .on(STALKER_REQUEST, (event, arg: any) => {
                axios
                    .get(arg.url, {
                        params: arg.params ?? {},
                        headers: {
                            Cookie: `mac=${arg.macAddress as string}`,
                            ...(arg.params.token
                                ? {
                                      Authorization: `Bearer ${
                                          arg.params.token as string
                                      }`,
                                  }
                                : {}),
                        },
                    })
                    .then((result) => {
                        event.sender.send(STALKER_RESPONSE, {
                            payload: result.data,
                            action: arg.params.action,
                        });
                    })
                    .catch((err) => {
                        event.sender.send(ERROR, {
                            message:
                                err.response?.statusText ?? 'Error: not found',
                            status: err.response?.status ?? 404,
                        });
                    });
            });
    }

    createMpvInstance() {
        const mpvPlayerPath = this.store.get(MPV_PLAYER_PATH);
        console.log('... getting mpv player path', mpvPlayerPath);
        return new mpvAPI(
            { ...(mpvPlayerPath ? { binary: mpvPlayerPath } : {}) },
            ['--autofit=70%']
        );
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

    getDefaultVlcPath() {
        if (process.platform === 'win32') {
            return path.join(
                'C:',
                'Program Files (x86)',
                'VideoLAN',
                'VLC',
                'vlc.exe'
            );
        } else if (process.platform === 'linux') {
            return '/usr/bin/vlc';
        } else if (process.platform === 'darwin') {
            return '/Applications/VLC.app/Contents/MacOS/VLC';
        }
    }

    getVlcPath() {
        const customVlcPath = this.store.get(VLC_PLAYER_PATH);
        if (customVlcPath) {
            return customVlcPath;
        } else {
            return this.getDefaultVlcPath();
        }
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
