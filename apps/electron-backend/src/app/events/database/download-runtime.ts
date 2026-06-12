import { eq, sql } from 'drizzle-orm';
import type { BrowserWindow } from 'electron';
import { CancelError, download } from 'electron-dl';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import {
    removePartialDownload,
    reserveAvailableDownloadFile,
} from './download-file-path';
import {
    attachDownloadItem,
    requestDownloadCancellation,
    type DownloadTask,
} from './download-task';

const downloadQueue: DownloadTask[] = [];
let activeDownload: DownloadTask | null = null;
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
    mainWindow = win;
}

export function broadcastDownloadUpdate(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('DOWNLOADS_UPDATE_EVENT');
    }
}

export function enqueueDownload(task: DownloadTask): void {
    downloadQueue.push(task);
    broadcastDownloadUpdate();
    void processQueue();
}

export async function cancelDownload(downloadId: number): Promise<boolean> {
    if (activeDownload?.id === downloadId) {
        requestDownloadCancellation(activeDownload);
        return true;
    }

    const queueIndex = downloadQueue.findIndex(
        (task) => task.id === downloadId
    );
    if (queueIndex === -1) {
        return false;
    }

    downloadQueue.splice(queueIndex, 1);
    const db = await getDatabase();
    await db
        .update(schema.downloads)
        .set({
            errorMessage: null,
            filePath: null,
            status: 'canceled',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, downloadId));
    broadcastDownloadUpdate();
    return true;
}

export function removeDownloadFromRuntime(downloadId: number): void {
    if (activeDownload?.id === downloadId) {
        requestDownloadCancellation(activeDownload);
    }

    const queueIndex = downloadQueue.findIndex(
        (task) => task.id === downloadId
    );
    if (queueIndex !== -1) {
        downloadQueue.splice(queueIndex, 1);
    }
}

async function processQueue(): Promise<void> {
    if (activeDownload || downloadQueue.length === 0) {
        return;
    }

    const task = downloadQueue.shift();
    if (!task) {
        return;
    }

    activeDownload = task;
    try {
        await startDownload(task);
    } catch (error) {
        console.error(
            `[Downloads] Unhandled error for ${task.fileName}:`,
            error
        );
        finishTask(task);
    }
}

function finishTask(task: DownloadTask): void {
    if (activeDownload === task) {
        activeDownload = null;
    }
    broadcastDownloadUpdate();
    void processQueue();
}

function createCancellationHandler(
    task: DownloadTask,
    db: Awaited<ReturnType<typeof getDatabase>>,
    reservation: ReturnType<typeof reserveAvailableDownloadFile>
): (item: Parameters<typeof removePartialDownload>[0]) => Promise<void> {
    let cancellationPromise: Promise<void> | undefined;

    return (item) => {
        cancellationPromise ??= (async () => {
            console.log(`[Downloads] Canceled: ${reservation.filename}`);
            removePartialFile(item);
            try {
                await db
                    .update(schema.downloads)
                    .set({
                        errorMessage: null,
                        filePath: null,
                        status: 'canceled',
                        updatedAt: sql`CURRENT_TIMESTAMP`,
                    })
                    .where(eq(schema.downloads.id, task.id));
            } catch (error) {
                console.error(
                    '[Downloads] Failed to persist cancellation:',
                    error
                );
            } finally {
                finishTask(task);
            }
        })();

        return cancellationPromise;
    };
}

async function startDownload(task: DownloadTask): Promise<void> {
    const db = await getDatabase();
    await db
        .update(schema.downloads)
        .set({
            errorMessage: null,
            filePath: null,
            status: 'downloading',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
    broadcastDownloadUpdate();

    if (!mainWindow || mainWindow.isDestroyed()) {
        console.error('[Downloads] No main window available');
        await db
            .update(schema.downloads)
            .set({
                errorMessage: 'No window available for download',
                status: 'failed',
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));
        finishTask(task);
        return;
    }

    let lastProgressUpdate = 0;
    const progressThrottleMs = 500;
    let handleCancellation:
        | ReturnType<typeof createCancellationHandler>
        | undefined;

    try {
        const reservation = reserveAvailableDownloadFile(
            task.directory,
            task.fileName
        );
        task.reservedPath = reservation.path;
        handleCancellation = createCancellationHandler(task, db, reservation);
        await db
            .update(schema.downloads)
            .set({
                errorMessage: null,
                fileName: reservation.filename,
                filePath: reservation.path,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));

        const downloadOptions: Parameters<typeof download>[2] = {
            directory: task.directory,
            filename: reservation.filename,
            onStarted: (item) => {
                console.log(`[Downloads] Started: ${reservation.filename}`);
                attachDownloadItem(task, item);
            },
            onProgress: async (progress) => {
                const now = Date.now();
                if (now - lastProgressUpdate < progressThrottleMs) {
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
                broadcastDownloadUpdate();
            },
            onCompleted: async (file) => {
                console.log(`[Downloads] Completed: ${file.filename}`);
                try {
                    await db
                        .update(schema.downloads)
                        .set({
                            bytesDownloaded: file.fileSize,
                            errorMessage: null,
                            fileName: file.filename,
                            filePath: file.path,
                            status: 'completed',
                            totalBytes: file.fileSize,
                            updatedAt: sql`CURRENT_TIMESTAMP`,
                        })
                        .where(eq(schema.downloads.id, task.id));
                } catch (error) {
                    console.error(
                        '[Downloads] Failed to persist completion:',
                        error
                    );
                } finally {
                    finishTask(task);
                }
            },
            onCancel: handleCancellation,
        };

        if (task.headers) {
            (
                downloadOptions as typeof downloadOptions & {
                    headers: Record<string, string>;
                }
            ).headers = task.headers;
        }

        await download(mainWindow, task.url, downloadOptions);
    } catch (error) {
        if (error instanceof CancelError) {
            const reservedPath = task.reservedPath;
            if (handleCancellation) {
                await handleCancellation(
                    task.downloadItem ??
                        (reservedPath
                            ? { getSavePath: () => reservedPath }
                            : undefined)
                );
            } else {
                finishTask(task);
            }
            return;
        }

        console.error(`[Downloads] Error downloading ${task.fileName}:`, error);
        const reservedPath = task.reservedPath;
        removePartialFile(
            task.downloadItem ??
                (reservedPath ? { getSavePath: () => reservedPath } : undefined)
        );
        await db
            .update(schema.downloads)
            .set({
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                filePath: null,
                status: 'failed',
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));
        finishTask(task);
    }
}

function removePartialFile(
    item: Parameters<typeof removePartialDownload>[0]
): void {
    try {
        removePartialDownload(item);
    } catch (error) {
        console.error('[Downloads] Failed to delete partial file:', error);
    }
}
