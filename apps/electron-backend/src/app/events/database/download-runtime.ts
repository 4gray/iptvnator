import { eq, sql } from 'drizzle-orm';
import type { BrowserWindow } from 'electron';
import { constants, createWriteStream, existsSync } from 'node:fs';
import { copyFile, link, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { requestWithValidatedRedirects } from '../../util/validated-axios';
import {
    getPartialDownloadPath,
    getPartialDownloadSize,
    removePartialDownloadFile,
    reserveAvailablePartialDownloadFile,
    type ReservedPartialDownloadFile,
} from './download-file-path';
import {
    requestDownloadCancellation,
    requestDownloadPause,
    type DownloadTask,
} from './download-task';

const downloadQueue: DownloadTask[] = [];
let activeDownload: DownloadTask | null = null;
let mainWindow: BrowserWindow | null = null;

type DownloadsDatabase = Awaited<ReturnType<typeof getDatabase>>;

interface TransferProgress {
    bytesDownloaded: number;
    totalBytes: number | null;
}

interface CompletedPartialProgress extends TransferProgress {
    filePath: string;
}

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
        removePartialFile(queuedTask?.filePath);
        const db = await getDatabase();
        await persistQueuedCancellation(db, downloadId);
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

    removePartialFile(item.filePath);
    await persistQueuedCancellation(db, downloadId);
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

async function persistQueuedCancellation(
    db: DownloadsDatabase,
    downloadId: number
): Promise<void> {
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: 0,
            errorMessage: null,
            filePath: null,
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

        const reservation = reserveTarget(task);
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

        const progress = await transferToPartialFile(db, task, reservation);
        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        let fileSize: number;
        try {
            fileSize = await finalizePartialDownload(
                reservation,
                progress.bytesDownloaded
            );
        } catch (error) {
            if (task.cancelRequested || task.pauseRequested) {
                throw error;
            }
            await persistFinalizationFailure(
                db,
                task,
                reservation,
                progress,
                error
            );
            return;
        }

        await persistCompletion(
            db,
            task,
            reservation.filename,
            reservation.path,
            fileSize,
            progress.totalBytes
        );
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

        console.error(`[Downloads] Error downloading ${task.fileName}:`, error);
        removePartialFile(task.filePath);
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
    } finally {
        task.abortController = undefined;
        finishTask(task);
    }
}

async function persistCompletion(
    db: DownloadsDatabase,
    task: DownloadTask,
    fileName: string,
    filePath: string,
    fileSize: number,
    totalBytes: number | null
): Promise<void> {
    console.log(`[Downloads] Completed: ${fileName}`);
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: fileSize,
            errorMessage: null,
            fileName,
            filePath,
            status: 'completed',
            totalBytes: totalBytes ?? fileSize,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
}

function reserveTarget(task: DownloadTask): ReservedPartialDownloadFile {
    if (task.filePath) {
        if (existsSync(task.filePath)) {
            throw new Error(`Destination file already exists: ${task.filePath}`);
        }

        return {
            filename: task.fileName,
            partialPath: getPartialDownloadPath(task.filePath),
            path: task.filePath,
        };
    }

    return reserveAvailablePartialDownloadFile(task.directory, task.fileName);
}

async function persistCancellation(
    db: DownloadsDatabase,
    task: DownloadTask
): Promise<void> {
    console.log(`[Downloads] Canceled: ${task.fileName}`);
    removePartialFile(task.filePath);
    try {
        await db
            .update(schema.downloads)
            .set({
                bytesDownloaded: 0,
                errorMessage: null,
                filePath: null,
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

async function persistFinalizationFailure(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile,
    progress: TransferProgress,
    error: unknown
): Promise<void> {
    await persistRetainedPartialFailure(
        db,
        task,
        reservation.filename,
        reservation.path,
        progress,
        error,
        `[Downloads] Error finalizing ${reservation.filename}:`
    );
}

async function persistCompletedPartialFailure(
    db: DownloadsDatabase,
    task: DownloadTask,
    progress: CompletedPartialProgress,
    error: unknown
): Promise<void> {
    await persistRetainedPartialFailure(
        db,
        task,
        task.fileName,
        progress.filePath,
        progress,
        error,
        `[Downloads] Error downloading ${task.fileName}:`
    );
}

async function persistRetainedPartialFailure(
    db: DownloadsDatabase,
    task: DownloadTask,
    fileName: string,
    filePath: string,
    progress: TransferProgress,
    error: unknown,
    logMessage: string
): Promise<void> {
    console.error(logMessage, error);
    const totalBytes = progress.totalBytes ?? progress.bytesDownloaded;
    task.totalBytes = totalBytes;
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: progress.bytesDownloaded,
            errorMessage:
                error instanceof Error ? error.message : String(error),
            fileName,
            filePath,
            status: 'failed',
            totalBytes,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
}

async function getExistingCompletedFileProgress(
    task: DownloadTask
): Promise<CompletedPartialProgress | null> {
    if (
        !task.filePath ||
        task.totalBytes === null ||
        task.totalBytes === undefined
    ) {
        return null;
    }

    try {
        const fileStats = await stat(task.filePath);
        if (fileStats.size !== task.totalBytes) {
            return null;
        }
        return {
            bytesDownloaded: fileStats.size,
            filePath: task.filePath,
            totalBytes: task.totalBytes,
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[Downloads] Failed to inspect target file:', error);
        }
        return null;
    }
}

function getCompletedPartialProgress(
    task: DownloadTask
): CompletedPartialProgress | null {
    if (
        !task.filePath ||
        task.totalBytes === null ||
        task.totalBytes === undefined
    ) {
        return null;
    }

    if (!existsSync(getPartialDownloadPath(task.filePath))) {
        return null;
    }

    try {
        const bytesDownloaded = getPartialDownloadSize(task.filePath);
        if (bytesDownloaded !== task.totalBytes) {
            return null;
        }
        return {
            bytesDownloaded,
            filePath: task.filePath,
            totalBytes: task.totalBytes,
        };
    } catch (error) {
        console.error('[Downloads] Failed to inspect partial file:', error);
        return null;
    }
}

function getPausedByteCount(task: DownloadTask): number {
    try {
        return getPartialDownloadSize(task.filePath);
    } catch (error) {
        console.error('[Downloads] Failed to inspect partial file:', error);
        return 0;
    }
}

async function transferToPartialFile(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile
): Promise<TransferProgress> {
    const resumeOffset = getPartialDownloadSize(reservation.path);
    if (task.totalBytes !== null && task.totalBytes !== undefined) {
        if (resumeOffset === task.totalBytes) {
            const progress = {
                bytesDownloaded: resumeOffset,
                totalBytes: task.totalBytes,
            };
            await persistProgress(db, task, progress);
            return progress;
        }
        if (resumeOffset > task.totalBytes) {
            throw new Error('Partial download is larger than expected');
        }
    }

    const headers = {
        ...(task.headers ?? {}),
    };
    if (resumeOffset > 0) {
        headers.Range = `bytes=${resumeOffset}-`;
    }

    const abortController = new AbortController();
    task.abortController = abortController;
    if (task.cancelRequested || task.pauseRequested) {
        abortController.abort();
    }

    console.log(`[Downloads] Started: ${reservation.filename}`);
    const response = await requestWithValidatedRedirects<Readable>(
        task.url,
        {
            headers,
            method: 'GET',
            responseType: 'stream',
            signal: abortController.signal,
            validateStatus: (status) => status >= 200 && status < 300,
        },
        { allowPrivateNetworks: true }
    );

    if (resumeOffset > 0 && response.status !== 206) {
        throw new Error('Server does not support resuming this download');
    }

    const totalBytes = getTotalBytes(response.headers, resumeOffset);
    task.totalBytes = totalBytes;

    let bytesDownloaded = resumeOffset;
    let lastProgressUpdate = 0;
    const progressThrottleMs = 500;
    const readable = response.data;
    const output = createWriteStream(reservation.partialPath, {
        flags: resumeOffset > 0 ? 'a' : 'w',
    });
    const abortStream = () => {
        readable.destroy(new Error('Download aborted'));
    };

    if (abortController.signal.aborted) {
        abortStream();
    } else {
        abortController.signal.addEventListener('abort', abortStream, {
            once: true,
        });
    }
    readable.on('data', (chunk: Buffer | string) => {
        bytesDownloaded += Buffer.isBuffer(chunk)
            ? chunk.length
            : Buffer.byteLength(chunk);
        const now = Date.now();
        if (now - lastProgressUpdate < progressThrottleMs) {
            return;
        }
        lastProgressUpdate = now;
        void persistProgress(db, task, {
            bytesDownloaded,
            totalBytes,
        }).catch((error) => {
            console.error('[Downloads] Failed to persist progress:', error);
        });
    });

    try {
        await pipeline(readable, output);
    } finally {
        abortController.signal.removeEventListener('abort', abortStream);
    }

    await persistProgress(db, task, { bytesDownloaded, totalBytes });
    return { bytesDownloaded, totalBytes };
}

async function persistProgress(
    db: DownloadsDatabase,
    task: DownloadTask,
    progress: TransferProgress
): Promise<void> {
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: progress.bytesDownloaded,
            totalBytes: progress.totalBytes,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
    broadcastDownloadUpdate();
}

async function finalizePartialDownload(
    reservation: ReservedPartialDownloadFile,
    expectedFileSize: number
): Promise<number> {
    try {
        await link(reservation.partialPath, reservation.path);
    } catch (error) {
        if (!canCopyCompletedPartialAfterLinkFailure(error)) {
            throw error;
        }
        await copyFile(
            reservation.partialPath,
            reservation.path,
            constants.COPYFILE_EXCL
        );
    }
    try {
        await unlink(reservation.partialPath);
    } catch (error) {
        const fileSize = await getExpectedFinalFileSize(
            reservation.path,
            expectedFileSize
        );
        if (fileSize !== null) {
            console.error(
                '[Downloads] Failed to delete completed partial file:',
                error
            );
            return fileSize;
        }
        throw error;
    }
    const fileStats = await stat(reservation.path);
    return fileStats.size;
}

async function getExpectedFinalFileSize(
    filePath: string,
    expectedFileSize: number
): Promise<number | null> {
    try {
        const fileStats = await stat(filePath);
        return fileStats.size === expectedFileSize ? fileStats.size : null;
    } catch {
        return null;
    }
}

function canCopyCompletedPartialAfterLinkFailure(error: unknown): boolean {
    const errorCode = (error as NodeJS.ErrnoException).code;
    return (
        errorCode === 'EACCES' ||
        errorCode === 'ENOSYS' ||
        errorCode === 'ENOTSUP' ||
        errorCode === 'EOPNOTSUPP' ||
        errorCode === 'EPERM' ||
        errorCode === 'EXDEV'
    );
}

function getTotalBytes(
    headers: unknown,
    resumeOffset: number
): number | null {
    const headerMap = headers as Record<string, unknown>;
    const contentRange = getHeaderValue(headerMap, 'content-range');
    if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
            return Number(match[1]);
        }
    }

    const contentLength = getHeaderValue(headerMap, 'content-length');
    if (!contentLength) {
        return null;
    }

    const parsed = Number(contentLength);
    return Number.isFinite(parsed) ? resumeOffset + parsed : null;
}

function getHeaderValue(
    headers: Record<string, unknown>,
    name: string
): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(value)) {
        return value.length > 0 ? String(value[0]) : undefined;
    }
    return value === undefined ? undefined : String(value);
}

function removePartialFile(filePath: string | null | undefined): void {
    try {
        removePartialDownloadFile(filePath);
    } catch (error) {
        console.error('[Downloads] Failed to delete partial file:', error);
    }
}
