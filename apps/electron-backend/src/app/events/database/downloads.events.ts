/**
 * Downloads IPC event handlers
 * Uses electron-dl for download management with queue control and progress tracking
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { download, File as ElectronDlFile } from 'electron-dl';
import { existsSync, unlinkSync } from 'fs';
import { basename, extname, join } from 'path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'canceled';

interface DownloadTask {
    id: number;
    url: string;
    fileName: string;
    directory: string;
    headers?: Record<string, string>;
    downloadItem?: ElectronDlFile;
}

// Download queue management
const downloadQueue: DownloadTask[] = [];
let activeDownload: DownloadTask | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Set the main window reference for sending updates
 */
export function setMainWindow(win: BrowserWindow) {
    mainWindow = win;
}

/**
 * Broadcast download updates to renderer
 */
function broadcastUpdate() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('DOWNLOADS_UPDATE_EVENT');
    }
}

/**
 * Get file extension from URL
 */
function getExtensionFromUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const ext = extname(pathname);
        return ext || '.mp4';
    } catch {
        return '.mp4';
    }
}

/**
 * Sanitize filename for filesystem
 */
function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * Process the download queue - starts next download if none active
 */
async function processQueue() {
    if (activeDownload || downloadQueue.length === 0) {
        return;
    }

    const task = downloadQueue.shift();
    if (!task) return;

    activeDownload = task;
    await startDownload(task);
}

/**
 * Start a download using electron-dl
 */
async function startDownload(task: DownloadTask) {
    const db = await getDatabase();

    // Update status to downloading
    await db
        .update(schema.downloads)
        .set({
            status: 'downloading',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));

    broadcastUpdate();

    if (!mainWindow || mainWindow.isDestroyed()) {
        console.error('[Downloads] No main window available');
        await db
            .update(schema.downloads)
            .set({
                status: 'failed',
                errorMessage: 'No window available for download',
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));
        activeDownload = null;
        broadcastUpdate();
        processQueue();
        return;
    }

    let lastProgressUpdate = 0;
    const PROGRESS_THROTTLE_MS = 500;

    try {
        const downloadOptions: Parameters<typeof download>[2] = {
            directory: task.directory,
            filename: task.fileName,
            overwrite: true,
            onStarted: (item) => {
                console.log(`[Downloads] Started: ${task.fileName}`);
                task.downloadItem = item as unknown as ElectronDlFile;
            },
            onProgress: async (progress) => {
                const now = Date.now();
                if (now - lastProgressUpdate < PROGRESS_THROTTLE_MS) {
                    return;
                }
                lastProgressUpdate = now;

                await db
                    .update(schema.downloads)
                    .set({
                        bytesDownloaded: progress.transferredBytes,
                        totalBytes: progress.totalBytes,
                        updatedAt: sql`CURRENT_TIMESTAMP`,
                    })
                    .where(eq(schema.downloads.id, task.id));

                broadcastUpdate();
            },
            onCompleted: async (file) => {
                console.log(`[Downloads] Completed: ${task.fileName}`);
                await db
                    .update(schema.downloads)
                    .set({
                        status: 'completed',
                        filePath: file.path,
                        fileName: file.filename,
                        bytesDownloaded: file.fileSize,
                        totalBytes: file.fileSize,
                        updatedAt: sql`CURRENT_TIMESTAMP`,
                    })
                    .where(eq(schema.downloads.id, task.id));

                activeDownload = null;
                broadcastUpdate();
                processQueue();
            },
            onCancel: async () => {
                console.log(`[Downloads] Canceled: ${task.fileName}`);
                // Delete partial file if it exists
                const partialPath = join(task.directory, task.fileName);
                if (existsSync(partialPath)) {
                    try {
                        unlinkSync(partialPath);
                    } catch (e) {
                        console.error('[Downloads] Failed to delete partial file:', e);
                    }
                }

                await db
                    .update(schema.downloads)
                    .set({
                        status: 'canceled',
                        updatedAt: sql`CURRENT_TIMESTAMP`,
                    })
                    .where(eq(schema.downloads.id, task.id));

                activeDownload = null;
                broadcastUpdate();
                processQueue();
            },
        };

        // Add headers if provided (user-agent, referer, origin)
        if (task.headers) {
            (downloadOptions as any).headers = task.headers;
        }

        await download(mainWindow, task.url, downloadOptions);
    } catch (error) {
        console.error(`[Downloads] Error downloading ${task.fileName}:`, error);

        // Delete partial file if it exists
        const partialPath = join(task.directory, task.fileName);
        if (existsSync(partialPath)) {
            try {
                unlinkSync(partialPath);
            } catch (e) {
                console.error('[Downloads] Failed to delete partial file:', e);
            }
        }

        await db
            .update(schema.downloads)
            .set({
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : String(error),
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));

        activeDownload = null;
        broadcastUpdate();
        processQueue();
    }
}

/**
 * Enqueue a new download
 */
ipcMain.handle(
    'DOWNLOADS_START',
    async (
        _event,
        data: {
            playlistId: string;
            xtreamId: number;
            contentType: 'vod' | 'episode';
            title: string;
            url: string;
            posterUrl?: string;
            downloadFolder: string;
            headers?: { userAgent?: string; referer?: string; origin?: string };
            seriesXtreamId?: number;
            seasonNumber?: number;
            episodeNumber?: number;
            // Playlist info for auto-creation if needed
            playlistName?: string;
            playlistType?: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';
            serverUrl?: string;
            portalUrl?: string;
            macAddress?: string;
        }
    ) => {
        try {
            console.log('[Downloads] Enqueue download:', data.title);
            const db = await getDatabase();

            // Ensure playlist exists in database (required for foreign key constraint)
            if (data.playlistId) {
                const existingPlaylist = await db
                    .select()
                    .from(schema.playlists)
                    .where(eq(schema.playlists.id, data.playlistId))
                    .limit(1);

                if (existingPlaylist.length === 0) {
                    // Create playlist entry for downloads to work
                    console.log('[Downloads] Creating playlist entry for:', data.playlistId);
                    await db.insert(schema.playlists).values({
                        id: data.playlistId,
                        name: data.playlistName || 'Unknown Playlist',
                        type: data.playlistType || 'stalker',
                        serverUrl: data.serverUrl,
                        macAddress: data.macAddress,
                        url: data.portalUrl,
                    });
                }
            } else {
                throw new Error('playlistId is required for downloads');
            }

            // Check if already exists
            const existing = await db
                .select()
                .from(schema.downloads)
                .where(
                    and(
                        eq(schema.downloads.playlistId, data.playlistId),
                        eq(schema.downloads.xtreamId, data.xtreamId),
                        eq(schema.downloads.contentType, data.contentType)
                    )
                )
                .limit(1);

            if (existing.length > 0) {
                const item = existing[0];
                // If completed or failed/canceled, allow retry by updating
                if (['completed', 'failed', 'canceled'].includes(item.status)) {
                    await db
                        .update(schema.downloads)
                        .set({
                            status: 'queued',
                            url: data.url,
                            bytesDownloaded: 0,
                            totalBytes: null,
                            errorMessage: null,
                            updatedAt: sql`CURRENT_TIMESTAMP`,
                        })
                        .where(eq(schema.downloads.id, item.id));

                    const ext = getExtensionFromUrl(data.url);
                    const fileName = sanitizeFilename(data.title) + ext;

                    downloadQueue.push({
                        id: item.id,
                        url: data.url,
                        fileName,
                        directory: data.downloadFolder,
                        headers: data.headers
                            ? {
                                  'User-Agent': data.headers.userAgent || '',
                                  Referer: data.headers.referer || '',
                                  Origin: data.headers.origin || '',
                              }
                            : undefined,
                    });

                    broadcastUpdate();
                    processQueue();
                    return { success: true, id: item.id };
                }

                // Already queued or downloading
                return { success: false, error: 'Download already in progress', id: item.id };
            }

            // Create new download entry
            const ext = getExtensionFromUrl(data.url);
            const fileName = sanitizeFilename(data.title) + ext;

            const result = await db.insert(schema.downloads).values({
                playlistId: data.playlistId,
                xtreamId: data.xtreamId,
                contentType: data.contentType,
                title: data.title,
                url: data.url,
                posterUrl: data.posterUrl,
                fileName,
                status: 'queued',
                seriesXtreamId: data.seriesXtreamId,
                seasonNumber: data.seasonNumber,
                episodeNumber: data.episodeNumber,
            });

            const insertedId = Number(result.lastInsertRowid);

            downloadQueue.push({
                id: insertedId,
                url: data.url,
                fileName,
                directory: data.downloadFolder,
                headers: data.headers
                    ? {
                          'User-Agent': data.headers.userAgent || '',
                          Referer: data.headers.referer || '',
                          Origin: data.headers.origin || '',
                      }
                    : undefined,
            });

            broadcastUpdate();
            processQueue();

            return { success: true, id: insertedId };
        } catch (error) {
            console.error('[Downloads] Error enqueuing download:', error);
            throw error;
        }
    }
);

/**
 * Cancel a download
 */
ipcMain.handle('DOWNLOADS_CANCEL', async (_event, downloadId: number) => {
    try {
        console.log('[Downloads] Cancel download:', downloadId);
        const db = await getDatabase();

        // Check if it's the active download
        if (activeDownload && activeDownload.id === downloadId) {
            if (activeDownload.downloadItem) {
                (activeDownload.downloadItem as any).cancel?.();
            }
            return { success: true };
        }

        // Remove from queue
        const queueIndex = downloadQueue.findIndex((t) => t.id === downloadId);
        if (queueIndex !== -1) {
            downloadQueue.splice(queueIndex, 1);
            await db
                .update(schema.downloads)
                .set({
                    status: 'canceled',
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(eq(schema.downloads.id, downloadId));

            broadcastUpdate();
            return { success: true };
        }

        return { success: false, error: 'Download not found in queue' };
    } catch (error) {
        console.error('[Downloads] Error canceling download:', error);
        throw error;
    }
});

/**
 * Retry a failed/canceled download
 */
ipcMain.handle(
    'DOWNLOADS_RETRY',
    async (_event, downloadId: number, downloadFolder: string) => {
        try {
            console.log('[Downloads] Retry download:', downloadId);
            const db = await getDatabase();

            const existing = await db
                .select()
                .from(schema.downloads)
                .where(eq(schema.downloads.id, downloadId))
                .limit(1);

            if (existing.length === 0) {
                return { success: false, error: 'Download not found' };
            }

            const item = existing[0];
            if (!['failed', 'canceled'].includes(item.status)) {
                return { success: false, error: 'Can only retry failed or canceled downloads' };
            }

            await db
                .update(schema.downloads)
                .set({
                    status: 'queued',
                    bytesDownloaded: 0,
                    totalBytes: null,
                    errorMessage: null,
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(eq(schema.downloads.id, downloadId));

            const ext = getExtensionFromUrl(item.url);
            const fileName = sanitizeFilename(item.title) + ext;

            downloadQueue.push({
                id: item.id,
                url: item.url,
                fileName,
                directory: downloadFolder,
            });

            broadcastUpdate();
            processQueue();

            return { success: true };
        } catch (error) {
            console.error('[Downloads] Error retrying download:', error);
            throw error;
        }
    }
);

/**
 * Remove a download from the list
 */
ipcMain.handle('DOWNLOADS_REMOVE', async (_event, downloadId: number) => {
    try {
        console.log('[Downloads] Remove download:', downloadId);
        const db = await getDatabase();

        // Cancel if active
        if (activeDownload && activeDownload.id === downloadId) {
            if (activeDownload.downloadItem) {
                (activeDownload.downloadItem as any).cancel?.();
            }
        }

        // Remove from queue
        const queueIndex = downloadQueue.findIndex((t) => t.id === downloadId);
        if (queueIndex !== -1) {
            downloadQueue.splice(queueIndex, 1);
        }

        // Delete from database
        await db.delete(schema.downloads).where(eq(schema.downloads.id, downloadId));

        broadcastUpdate();
        return { success: true };
    } catch (error) {
        console.error('[Downloads] Error removing download:', error);
        throw error;
    }
});

/**
 * Get all downloads for a playlist
 */
ipcMain.handle('DOWNLOADS_GET_LIST', async (_event, playlistId?: string) => {
    try {
        const db = await getDatabase();

        if (playlistId) {
            const result = await db
                .select()
                .from(schema.downloads)
                .where(eq(schema.downloads.playlistId, playlistId))
                .orderBy(schema.downloads.createdAt);
            return result;
        }

        const result = await db
            .select()
            .from(schema.downloads)
            .orderBy(schema.downloads.createdAt);
        return result;
    } catch (error) {
        console.error('[Downloads] Error getting download list:', error);
        throw error;
    }
});

/**
 * Get download by ID
 */
ipcMain.handle('DOWNLOADS_GET', async (_event, downloadId: number) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.downloads)
            .where(eq(schema.downloads.id, downloadId))
            .limit(1);
        return result[0] || null;
    } catch (error) {
        console.error('[Downloads] Error getting download:', error);
        throw error;
    }
});

/**
 * Get default download folder
 */
ipcMain.handle('DOWNLOADS_GET_DEFAULT_FOLDER', async () => {
    return app.getPath('downloads');
});

/**
 * Select download folder via dialog
 */
ipcMain.handle('DOWNLOADS_SELECT_FOLDER', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Download Folder',
        defaultPath: app.getPath('downloads'),
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths[0];
});

/**
 * Reveal file in system file manager
 */
ipcMain.handle('DOWNLOADS_REVEAL_FILE', async (_event, filePath: string) => {
    if (existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { success: true };
    }
    return { success: false, error: 'File not found' };
});

/**
 * Play downloaded file
 */
ipcMain.handle('DOWNLOADS_PLAY_FILE', async (_event, filePath: string) => {
    if (existsSync(filePath)) {
        await shell.openPath(filePath);
        return { success: true };
    }
    return { success: false, error: 'File not found' };
});

/**
 * Clear all completed downloads
 */
ipcMain.handle('DOWNLOADS_CLEAR_COMPLETED', async (_event, playlistId?: string) => {
    try {
        const db = await getDatabase();

        if (playlistId) {
            await db
                .delete(schema.downloads)
                .where(
                    and(
                        eq(schema.downloads.playlistId, playlistId),
                        inArray(schema.downloads.status, ['completed', 'failed', 'canceled'])
                    )
                );
        } else {
            await db
                .delete(schema.downloads)
                .where(
                    inArray(schema.downloads.status, ['completed', 'failed', 'canceled'])
                );
        }

        broadcastUpdate();
        return { success: true };
    } catch (error) {
        console.error('[Downloads] Error clearing completed:', error);
        throw error;
    }
});

/**
 * Reset stale downloads on startup (downloading -> failed)
 */
export async function resetStaleDownloads() {
    try {
        const db = await getDatabase();
        await db
            .update(schema.downloads)
            .set({
                status: 'failed',
                errorMessage: 'Download interrupted by application restart',
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(
                inArray(schema.downloads.status, ['queued', 'downloading'])
            );
        console.log('[Downloads] Reset stale downloads');
    } catch (error) {
        console.error('[Downloads] Error resetting stale downloads:', error);
    }
}
