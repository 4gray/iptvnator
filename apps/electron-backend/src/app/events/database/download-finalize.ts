import { eq, sql } from 'drizzle-orm';
import { constants, existsSync } from 'node:fs';
import { copyFile, link, stat, unlink } from 'node:fs/promises';
import * as schema from '../../database/schema';
import {
    getPartialDownloadPath,
    getPartialDownloadSize,
    removePartialDownloadFile,
    type ReservedPartialDownloadFile,
} from './download-file-path';
import type {
    CompletedPartialProgress,
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';
import { describeError, TruncatedTransferError } from './download-transfer';

/**
 * Persistence for a failed startDownload() attempt, after its cancel/pause
 * checkpoints have been ruled out. Chooses between: retaining a truncated
 * transfer for a Range retry, committing an already-finalized file,
 * retaining a completed partial, or the generic delete-partial failure.
 */
export async function handleDownloadFailure(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile | undefined,
    error: unknown
): Promise<void> {
    if (error instanceof TruncatedTransferError && reservation) {
        // The short response is retained so a retry can continue the
        // transfer via Range instead of starting over.
        await persistCompletedPartialFailure(
            db,
            task,
            {
                bytesDownloaded: error.progress.bytesDownloaded,
                filePath: reservation.path,
                totalBytes: error.progress.totalBytes,
            },
            error
        );
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
}

export async function completeDownloadFromPartial(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile,
    progress: TransferProgress
): Promise<void> {
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
}

export async function persistCompletion(
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
            resumeValidator: null,
            status: 'completed',
            totalBytes: totalBytes ?? fileSize,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
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

export async function persistCompletedPartialFailure(
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
    console.error(logMessage, describeError(error));
    const totalBytes = progress.totalBytes ?? progress.bytesDownloaded;
    task.totalBytes = totalBytes;
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: progress.bytesDownloaded,
            errorMessage: describeError(error),
            fileName,
            filePath,
            status: 'failed',
            totalBytes,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
}

export async function getExistingCompletedFileProgress(
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

export function getCompletedPartialProgress(
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

export function getPausedByteCount(task: DownloadTask): number {
    try {
        return getPartialDownloadSize(task.filePath);
    } catch (error) {
        console.error('[Downloads] Failed to inspect partial file:', error);
        return 0;
    }
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

/** @returns false when a .part exists but could not be deleted. */
export function removePartialFile(filePath: string | null | undefined): boolean {
    try {
        removePartialDownloadFile(filePath);
        return true;
    } catch (error) {
        console.error('[Downloads] Failed to delete partial file:', error);
        return false;
    }
}
