/**
 * This module is responsible on handling all the inter process communications
 * between the frontend to the electron backend.
 */

import { app, dialog, ipcMain, WebContents } from 'electron';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import {
    AUTO_UPDATE_PLAYLISTS,
    PLAYLIST_CANCEL_REFRESH,
    PLAYLIST_REFRESH,
    PLAYLIST_REFRESH_CANCELLED_RESULT_TYPE,
    PLAYLIST_REFRESH_EVENT,
    ElectronBridgeTrustOptions,
    ElectronBridgePlaylistFetchOptions,
    Playlist,
    PlaylistRefreshCancelledResult,
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
    summarizeAutoUpdateOutcomes,
} from '@iptvnator/shared/interfaces';
import { resolveWorkerRuntimeBootstrap } from '../workers/worker-runtime-paths';
import type {
    PlaylistRefreshWorkerMessage,
    PlaylistRefreshWorkerResponseMessage,
} from '../workers/playlist-refresh.worker.types';
import { autoUpdatePlaylists } from './playlist-auto-update';
import {
    derivePlaylistTitleFromFilePath,
    fetchPlaylistFromFile,
    fetchPlaylistFromUrl,
} from './playlist-source';
import { PlaylistWriteAuthorizer } from './playlist-write-authorization';
import { createM3uImportPerformanceCapture } from './playlist-import-performance';
import { isPerformanceCaptureEnabled } from '../services/debug-trace';

export default class PlaylistEvents {
    static bootstrapPlaylistEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

const playlistWriteAuthorizer = new PlaylistWriteAuthorizer();

type ActivePlaylistRefresh = {
    cancel: () => Promise<void>;
};

const activePlaylistRefreshes = new Map<string, ActivePlaylistRefresh>();

function resolvePlaylistRefreshWorker(): Worker {
    const bootstrap = resolveWorkerRuntimeBootstrap({
        isPackaged: app.isPackaged,
        workerFilename: 'playlist-refresh.worker.js',
        developmentWorkerDir: __dirname + '/workers',
        resourcesPath: (process as NodeJS.Process & { resourcesPath?: string })
            .resourcesPath,
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

ipcMain.handle(
    'fetch-playlist-by-url',
    async (
        event,
        url,
        title?: string,
        options?: ElectronBridgePlaylistFetchOptions
    ) => {
        try {
            const performanceCapture = createM3uImportPerformanceCapture({
                enabled: isPerformanceCaptureEnabled(),
            });
            return await fetchPlaylistFromUrl(url, title, {
                performanceCapture,
                userAgent: options?.userAgent,
                trustedInsecureTlsHosts: options?.trustedInsecureTlsHosts,
            });
        } catch (error) {
            console.error(
                'Error fetching playlist:',
                redactSensitiveData(error)
            );
            throw error;
        }
    }
);

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
        const title = derivePlaylistTitleFromFilePath(filePath);

        return await fetchPlaylistFromFile(filePath, title);
    } catch (error) {
        console.error('Error reading or parsing the file:', error);
        throw new Error('Failed to process the selected file.');
    }
});

ipcMain.handle(
    AUTO_UPDATE_PLAYLISTS,
    async (
        event,
        playlists: Playlist[],
        options?: ElectronBridgeTrustOptions
    ) => {
        console.log(`Auto-updating ${playlists.length} playlist(s)...`);

        const result = await autoUpdatePlaylists(playlists, {
            trustedInsecureTlsHosts: options?.trustedInsecureTlsHosts,
        });
        const summary = summarizeAutoUpdateOutcomes(result.outcomes);

        console.log(
            `Auto-update completed: ${summary.updated} updated, ${summary.failed} failed, ${summary.skipped} skipped`
        );
        return result;
    }
);

ipcMain.handle(
    PLAYLIST_REFRESH,
    async (event, payload: PlaylistRefreshPayload) => {
        const worker = resolvePlaylistRefreshWorker();

        return await new Promise<Playlist | PlaylistRefreshCancelledResult>(
            (resolve, reject) => {
                let cleanupPromise: Promise<void> | null = null;
                let lastPhase: PlaylistRefreshEvent['phase'] = payload.url
                    ? 'fetching'
                    : 'reading-file';
                let settled = false;

                const cleanup = (): Promise<void> => {
                    cleanupPromise ??= (async () => {
                        activePlaylistRefreshes.delete(payload.operationId);
                        worker.removeAllListeners();
                        await worker.terminate().catch(() => undefined);
                    })();
                    return cleanupPromise;
                };

                const cancel = async (): Promise<void> => {
                    if (settled) {
                        return;
                    }
                    settled = true;

                    try {
                        worker.postMessage({
                            type: 'cancel',
                            operationId: payload.operationId,
                        });
                    } catch {
                        // Termination below is authoritative even if cooperative
                        // cancellation cannot be delivered.
                    }

                    await cleanup();
                    emitPlaylistRefreshEvent(event.sender, {
                        operationId: payload.operationId,
                        playlistId: payload.playlistId,
                        phase: lastPhase,
                        status: 'cancelled',
                    });
                    resolve({
                        operationId: payload.operationId,
                        type: PLAYLIST_REFRESH_CANCELLED_RESULT_TYPE,
                    });
                };

                const activeRefresh: ActivePlaylistRefresh = { cancel };
                activePlaylistRefreshes.set(payload.operationId, activeRefresh);

                worker.on(
                    'message',
                    async (message: PlaylistRefreshWorkerMessage<Playlist>) => {
                        if (settled) {
                            return;
                        }

                        if (message.type === 'ready') {
                            worker.postMessage({
                                type: 'request',
                                payload,
                            });
                            return;
                        }

                        if (message.type === 'event') {
                            lastPhase = message.event.phase ?? lastPhase;
                            emitPlaylistRefreshEvent(
                                event.sender,
                                message.event
                            );
                            return;
                        }

                        settled = true;
                        await cleanup();

                        const response =
                            message as PlaylistRefreshWorkerResponseMessage<Playlist>;
                        if (response.success && response.result) {
                            resolve(response.result);
                            return;
                        }

                        reject(
                            createPlaylistRefreshError(
                                response.error ?? {
                                    message:
                                        'Playlist refresh worker request failed',
                                }
                            )
                        );
                    }
                );

                worker.on('error', async (error) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    await cleanup();
                    reject(error);
                });

                worker.on('exit', async (code) => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    await cleanup();
                    reject(
                        new Error(
                            code === 0
                                ? 'Playlist refresh worker exited unexpectedly'
                                : `Playlist refresh worker stopped with exit code ${code}`
                        )
                    );
                });
            }
        );
    }
);

ipcMain.handle(
    PLAYLIST_CANCEL_REFRESH,
    async (_event, operationId: string): Promise<{ success: boolean }> => {
        const activeRefresh = activePlaylistRefreshes.get(operationId);
        if (!activeRefresh) {
            return { success: false };
        }

        await activeRefresh.cancel();

        return { success: true };
    }
);

ipcMain.handle('save-file-dialog', async (event, defaultPath, filters) => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath,
            filters: filters || [{ name: 'All Files', extensions: ['*'] }],
        });

        if (canceled || !filePath) {
            return null;
        }

        playlistWriteAuthorizer.authorize(event.sender.id, filePath);
        return filePath;
    } catch (error) {
        console.error('Error showing save dialog:', error);
        throw error;
    }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
    let normalizedPath: string;
    try {
        normalizedPath = playlistWriteAuthorizer.consume(
            event.sender.id,
            filePath
        );
    } catch (error) {
        console.error('Blocked unauthorized write-file path:', filePath);
        throw error;
    }
    try {
        await writeFile(normalizedPath, content, 'utf-8');
        return { success: true };
    } catch (error) {
        console.error('Error writing file:', error);
        throw error;
    }
});
