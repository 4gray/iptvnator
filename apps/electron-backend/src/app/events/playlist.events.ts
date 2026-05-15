/**
 * This module is responsible on handling all the inter process communications
 * between the frontend to the electron backend.
 */

import axios from 'axios';
import { app, dialog, ipcMain, WebContents } from 'electron';
import { parse } from 'iptv-playlist-parser';
import { createPlaylistObject, getFilenameFromUrl } from '@iptvnator/shared/m3u-utils';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import {
    AUTO_UPDATE_PLAYLISTS,
    PLAYLIST_CANCEL_REFRESH,
    PLAYLIST_REFRESH,
    PLAYLIST_REFRESH_EVENT,
    Playlist,
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
} from '@iptvnator/shared/interfaces';
import { resolveWorkerRuntimeBootstrap } from '../workers/worker-runtime-paths';
import type {
    PlaylistRefreshWorkerMessage,
    PlaylistRefreshWorkerResponseMessage,
} from '../workers/playlist-refresh.worker.types';

export default class PlaylistEvents {
    static bootstrapPlaylistEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

const https = require('https');

type ActivePlaylistRefresh = {
    reject: (reason?: unknown) => void;
    resolve: (value: Playlist) => void;
    sender: WebContents;
    worker: Worker;
};

const activePlaylistRefreshes = new Map<string, ActivePlaylistRefresh>();

/**
 * Fetches and parses a playlist from a URL
 * @param url - The URL to fetch the playlist from
 * @param title - Optional title for the playlist
 * @returns Parsed playlist object
 */
async function fetchPlaylistFromUrl(
    url: string,
    title?: string
): Promise<any> {
    const agent = new https.Agent({
        rejectUnauthorized: false,
    });
    const result = await axios.get(url, { httpsAgent: agent });
    const parsedPlaylist = parse(result.data);

    const extractedName =
        url && url.length > 1 ? getFilenameFromUrl(url) : '';
    const playlistName =
        !extractedName || extractedName === 'Untitled playlist'
            ? 'Imported from URL'
            : extractedName;

    const playlistObject = createPlaylistObject(
        title ?? playlistName,
        parsedPlaylist,
        url,
        'URL'
    );

    return playlistObject;
}

/**
 * Reads and parses a playlist from a file path
 * @param filePath - The path to the playlist file
 * @param title - Title for the playlist
 * @returns Parsed playlist object
 */
async function fetchPlaylistFromFile(
    filePath: string,
    title: string
): Promise<any> {
    const fileContent = await readFile(filePath, 'utf-8');
    const parsedPlaylist = parse(fileContent);
    const playlistObject = createPlaylistObject(
        title,
        parsedPlaylist,
        filePath,
        'FILE'
    );
    return playlistObject;
}

function resolvePlaylistRefreshWorker(): Worker {
    const bootstrap = resolveWorkerRuntimeBootstrap({
        isPackaged: app.isPackaged,
        workerFilename: 'playlist-refresh.worker.js',
        developmentWorkerDir: __dirname + '/workers',
        resourcesPath: (
            process as NodeJS.Process & { resourcesPath?: string }
        ).resourcesPath,
        appPath: app.getAppPath(),
    });

    return new Worker(pathToFileURL(bootstrap.workerPath), {
        workerData: {
            nativeModuleSearchPaths: bootstrap.nativeModuleSearchPaths,
        },
    });
}

function emitPlaylistRefreshEvent(
    sender: WebContents,
    event: PlaylistRefreshEvent
): void {
    if (sender.isDestroyed()) {
        return;
    }

    sender.send(PLAYLIST_REFRESH_EVENT, event);
}

function createPlaylistRefreshError(error: {
    message: string;
    name?: string;
    stack?: string;
}): Error {
    const workerError = new Error(error.message);
    workerError.name = error.name || 'PlaylistRefreshWorkerError';
    workerError.stack = error.stack || workerError.stack;
    return workerError;
}

ipcMain.handle('fetch-playlist-by-url', async (event, url, title?: string) => {
    try {
        return await fetchPlaylistFromUrl(url, title);
    } catch (error) {
        console.error('Error fetching playlist:', error);
        throw error;
    }
});

ipcMain.handle(
    'update-playlist-from-file-path',
    async (event, filePath, title) => {
        try {
            return await fetchPlaylistFromFile(filePath, title);
        } catch (error) {
            console.error('Error reading playlist from file:', error);
            throw error;
        }
    }
);

ipcMain.handle('open-playlist-from-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Playlists', extensions: ['m3u', 'm3u8', 'pls', 'txt'] },
            { name: 'All Files', extensions: ['*'] },
        ],
    });

    if (canceled || filePaths.length === 0) {
        console.log('User canceled file open dialog.');
        return null;
    }

    const filePath = filePaths[0];

    try {
        // Extract filename from path and remove extension for a clean title
        const filename = basename(filePath);
        const title = filename.replace(/\.(m3u8?|pls|txt)$/i, '') || 'from file';

        return await fetchPlaylistFromFile(filePath, title);
    } catch (error) {
        console.error('Error reading or parsing the file:', error);
        throw new Error('Failed to process the selected file.');
    }
});

ipcMain.handle(AUTO_UPDATE_PLAYLISTS, async (event, playlists) => {
    console.log(`Auto-updating ${playlists.length} playlist(s)...`);

    const updatedPlaylists = [];

    for (const playlist of playlists) {
        try {
            let playlistObject;

            if (playlist.importDate && playlist.url) {
                // Update from URL
                console.log(
                    `Updating playlist "${playlist.title}" from URL: ${playlist.url}`
                );
                playlistObject = await fetchPlaylistFromUrl(
                    playlist.url,
                    playlist.title
                );
            } else if (playlist.filePath) {
                // Update from file path
                console.log(
                    `Updating playlist "${playlist.title}" from file: ${playlist.filePath}`
                );
                playlistObject = await fetchPlaylistFromFile(
                    playlist.filePath,
                    playlist.title
                );
            } else {
                console.warn(
                    `Skipping playlist "${playlist.title}": no URL or file path found`
                );
                continue;
            }

            // Preserve user data when updating playlist
            updatedPlaylists.push({
                ...playlistObject,
                _id: playlist._id,
                autoRefresh: playlist.autoRefresh,
                favorites: playlist.favorites || [], // Preserve favorites
                userAgent: playlist.userAgent, // Preserve custom user agent
            });

            console.log(`Successfully updated playlist "${playlist.title}"`);
        } catch (error) {
            console.error(
                `Failed to update playlist "${playlist.title}":`,
                error
            );
            // Continue with other playlists even if one fails
        }
    }

    console.log(`Auto-update completed: ${updatedPlaylists.length} updated`);
    return updatedPlaylists;
});

ipcMain.handle(PLAYLIST_REFRESH, async (event, payload: PlaylistRefreshPayload) => {
    const worker = resolvePlaylistRefreshWorker();

    return await new Promise<Playlist>((resolve, reject) => {
        const cleanup = async (): Promise<void> => {
            activePlaylistRefreshes.delete(payload.operationId);
            worker.removeAllListeners();
            await worker.terminate().catch(() => undefined);
        };

        activePlaylistRefreshes.set(payload.operationId, {
            worker,
            sender: event.sender,
            resolve,
            reject,
        });

        worker.on('message', async (message: PlaylistRefreshWorkerMessage<Playlist>) => {
            if (message.type === 'ready') {
                worker.postMessage({
                    type: 'request',
                    payload,
                });
                return;
            }

            if (message.type === 'event') {
                emitPlaylistRefreshEvent(event.sender, message.event);
                return;
            }

            await cleanup();

            const response = message as PlaylistRefreshWorkerResponseMessage<Playlist>;
            if (response.success && response.result) {
                resolve(response.result);
                return;
            }

            reject(
                createPlaylistRefreshError(
                    response.error ?? {
                        message: 'Playlist refresh worker request failed',
                    }
                )
            );
        });

        worker.on('error', async (error) => {
            await cleanup();
            reject(error);
        });

        worker.on('exit', async (code) => {
            if (!activePlaylistRefreshes.has(payload.operationId)) {
                return;
            }

            await cleanup();
            reject(
                new Error(
                    code === 0
                        ? 'Playlist refresh worker exited unexpectedly'
                        : `Playlist refresh worker stopped with exit code ${code}`
                )
            );
        });
    });
});

ipcMain.handle(
    PLAYLIST_CANCEL_REFRESH,
    async (_event, operationId: string): Promise<{ success: boolean }> => {
        const activeRefresh = activePlaylistRefreshes.get(operationId);
        if (!activeRefresh) {
            return { success: false };
        }

        activeRefresh.worker.postMessage({
            type: 'cancel',
            operationId,
        });

        return { success: true };
    }
);

ipcMain.handle('save-file-dialog', async (event, defaultPath, filters) => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath,
            filters: filters || [
                { name: 'All Files', extensions: ['*'] },
            ],
        });

        if (canceled || !filePath) {
            return null;
        }

        return filePath;
    } catch (error) {
        console.error('Error showing save dialog:', error);
        throw error;
    }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
    try {
        await writeFile(filePath, content, 'utf-8');
        return { success: true };
    } catch (error) {
        console.error('Error writing file:', error);
        throw error;
    }
});
