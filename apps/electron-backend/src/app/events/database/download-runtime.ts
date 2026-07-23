import { eq, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { broadcastDownloadUpdate } from './download-broadcast';
import {
    findAvailableFinalPath,
    getPartialDownloadPath,
    reserveAvailablePartialDownloadFile,
    type ReservedPartialDownloadFile,
} from './download-file-path';
import {
    completeDownloadFromPartial,
    getCompletedPartialProgress,
    getExistingCompletedFileProgress,
    getPausedByteCount,
    persistCompletedPartialFailure,
    persistCompletion,
    removePartialFile,
} from './download-finalize';
import {
    requestDownloadCancellation,
    requestDownloadPause,
    type DownloadsDatabase,
    type DownloadTask,
} from './download-task';
import { describeError, transferToPartialFile } from './download-transfer';

export {
    broadcastDownloadUpdate,
    setMainWindow,
} from './download-broadcast';

const downloadQueue: DownloadTask[] = [];
let activeDownload: DownloadTask | null = null;

export function enqueueDownload(task: DownloadTask): void {
    // A duplicate id (e.g. two rapid Resume clicks racing the status
    // refresh) must not produce two transfers for the same row.
    if (
        activeDownload?.id === task.id ||
        downloadQueue.some((queued) => queued.id === task.id)
    ) {
        return;
    }

    downloadQueue.push(task);
    broadcastDownloadUpdate();
    void processQueue();
}

export async function pauseDownload(downloadId: number): Promise<boolean> {
    if (activeDownload?.id === downloadId) {
        requestDownloadPause(activeDownload);
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
            status: 'paused',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, downloadId));
    broadcastDownloadUpdate();
    return true;
}

export async function cancelDownload(downloadId: number): Promise<boolean> {
    if (activeDownload?.id === downloadId) {
        requestDownloadCancellation(activeDownload);
        return true;
    }

    const queueIndex = downloadQueue.findIndex(
        (task) => task.id === downloadId
    );
    if (queueIndex !== -1) {
        const [queuedTask] = downloadQueue.splice(queueIndex, 1);
        const removed = removePartialFile(queuedTask?.filePath);
        const db = await getDatabase();
        await persistQueuedCancellation(
            db,
            downloadId,
            removed ? null : (queuedTask?.filePath ?? null)
        );
        broadcastDownloadUpdate();
        return true;
    }

    const db = await getDatabase();
    const rows = await db
        .select({
            filePath: schema.downloads.filePath,
            status: schema.downloads.status,
        })
        .from(schema.downloads)
        .where(eq(schema.downloads.id, downloadId))
        .limit(1);
    const item = rows[0];
    if (item?.status !== 'paused') {
        return false;
    }

    const removed = removePartialFile(item.filePath);
    await persistQueuedCancellation(
        db,
        downloadId,
        removed ? null : item.filePath
    );
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
            describeError(error)
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

async function persistQueuedCancellation(
    db: DownloadsDatabase,
    downloadId: number,
    // Keep the path when the retained .part could not be deleted, so a later
    // remove/clear can retry the cleanup instead of orphaning the file.
    retainedFilePath: string | null = null
): Promise<void> {
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: 0,
            errorMessage: null,
            filePath: retainedFilePath,
            resumeValidator: null,
            status: 'canceled',
            totalBytes: null,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, downloadId));
}

async function startDownload(task: DownloadTask): Promise<void> {
    const db = await getDatabase();
    await db
        .update(schema.downloads)
        .set({
            errorMessage: null,
            status: 'downloading',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
    broadcastDownloadUpdate();

    try {
        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        const reservation = await reserveTarget(task);
        task.fileName = reservation.filename;
        task.filePath = reservation.path;
        await db
            .update(schema.downloads)
            .set({
                errorMessage: null,
                fileName: reservation.filename,
                filePath: reservation.path,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));

        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        const completedPartialProgress = getCompletedPartialProgress(task);
        if (completedPartialProgress) {
            await completeDownloadFromPartial(
                db,
                task,
                reservation,
                completedPartialProgress
            );
            return;
        }

        const progress = await transferToPartialFile(db, task, reservation);
        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        await completeDownloadFromPartial(db, task, reservation, progress);
    } catch (error) {
        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        const existingCompletedFileProgress =
            await getExistingCompletedFileProgress(task);
        if (existingCompletedFileProgress) {
            removePartialFile(existingCompletedFileProgress.filePath);
            await persistCompletion(
                db,
                task,
                task.fileName,
                existingCompletedFileProgress.filePath,
                existingCompletedFileProgress.bytesDownloaded,
                existingCompletedFileProgress.totalBytes
            );
            return;
        }

        const completedPartialProgress = getCompletedPartialProgress(task);
        if (completedPartialProgress) {
            await persistCompletedPartialFailure(
                db,
                task,
                completedPartialProgress,
                error
            );
            return;
        }

        console.error(
            `[Downloads] Error downloading ${task.fileName}:`,
            describeError(error)
        );
        removePartialFile(task.filePath);
        await db
            .update(schema.downloads)
            .set({
                errorMessage: describeError(error),
                filePath: null,
                resumeValidator: null,
                status: 'failed',
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));
    } finally {
        task.abortController = undefined;
        finishTask(task);
    }
}

async function reserveTarget(
    task: DownloadTask
): Promise<ReservedPartialDownloadFile> {
    if (task.filePath) {
        if (!existsSync(task.filePath)) {
            return {
                filename: task.fileName,
                partialPath: getPartialDownloadPath(task.filePath),
                path: task.filePath,
            };
        }

        // Something now occupies the recorded destination — possibly a file
        // the user created while this download was paused or failed. Never
        // inspect or delete it: move the retained .part to the next free
        // numbered destination and finalize there instead.
        const redirected = findAvailableFinalPath(task.filePath);
        const currentPartial = getPartialDownloadPath(task.filePath);
        const redirectedPartial = getPartialDownloadPath(redirected.path);
        if (existsSync(currentPartial)) {
            await rename(currentPartial, redirectedPartial);
        }

        return {
            filename: redirected.filename,
            partialPath: redirectedPartial,
            path: redirected.path,
        };
    }

    return reserveAvailablePartialDownloadFile(task.directory, task.fileName);
}

async function persistCancellation(
    db: DownloadsDatabase,
    task: DownloadTask
): Promise<void> {
    console.log(`[Downloads] Canceled: ${task.fileName}`);
    const removed = removePartialFile(task.filePath);
    try {
        await db
            .update(schema.downloads)
            .set({
                bytesDownloaded: 0,
                errorMessage: null,
                filePath: removed ? null : (task.filePath ?? null),
                resumeValidator: null,
                status: 'canceled',
                totalBytes: null,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));
    } catch (error) {
        console.error('[Downloads] Failed to persist cancellation:', error);
    }
}

async function persistPause(
    db: DownloadsDatabase,
    task: DownloadTask
): Promise<void> {
    console.log(`[Downloads] Paused: ${task.fileName}`);
    const bytesDownloaded = getPausedByteCount(task);
    try {
        await db
            .update(schema.downloads)
            .set({
                bytesDownloaded,
                errorMessage: null,
                fileName: task.fileName,
                filePath: task.filePath ?? null,
                status: 'paused',
                totalBytes: task.totalBytes ?? null,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));
    } catch (error) {
        console.error('[Downloads] Failed to persist pause:', error);
    }
}
