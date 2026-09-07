import { recordArchiveFinalization } from './download-catchup-journal';
import {
    finalizePartialDownload,
    removePartialFile,
} from './download-file-finalize';
import { cleanupCatchupPartial } from './download-catchup-cleanup';
import {
    finalizeCatchupPartial,
    recoverCatchupCompletion,
} from './download-catchup-finalize';
import { eq, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as schema from '../../database/schema';
import {
    getPartialDownloadPath,
    getPartialDownloadSize,
    type ReservedPartialDownloadFile,
} from './download-file-path';
import type {
    CompletedPartialProgress,
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';
import {
    describeError,
    InterruptedTransferError,
    TruncatedTransferError,
} from './download-transfer';

/**
 * Persistence for a failed startDownload() attempt, after its cancel/pause
 * checkpoints have been ruled out. Chooses between: retaining a recoverable
 * partial for a Range retry, committing an already-finalized file,
 * retaining a completed partial, or the generic delete-partial failure.
 */
export async function handleDownloadFailure(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile | undefined,
    error: unknown
): Promise<void> {
    if (
        (error instanceof TruncatedTransferError ||
            error instanceof InterruptedTransferError) &&
        reservation
    ) {
        // The recoverable partial is retained so a retry can continue the
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
        if (task.catchup) {
            await cleanupCatchupPartial(
                task.filePath,
                task.catchupPartialIdentity
            );
        } else removePartialFile(existingCompletedFileProgress.filePath);
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
    const removed = task.catchup
        ? await cleanupCatchupPartial(
              task.filePath,
              task.catchupPartialIdentity
          )
        : removePartialFile(task.filePath);
    await db
        .update(schema.downloads)
        .set({
            errorMessage: describeError(error),
            filePath: task.catchup && !removed ? (task.filePath ?? null) : null,
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
        if (task.catchup) {
            const partialIdentity = task.catchupPartialIdentity;
            if (!partialIdentity)
                throw new Error('Archive transfer identity is unavailable');
            const finalized = await finalizeCatchupPartial(
                reservation,
                task.catchupPartialIdentity,
                progress.bytesDownloaded,
                (finalIdentity) =>
                    recordArchiveFinalization(db, task.id, {
                        version: 1,
                        filePath: reservation.path,
                        size: progress.bytesDownloaded,
                        partialIdentity,
                        finalIdentity,
                    }),
                () => !!(task.cancelRequested || task.pauseRequested),
                () => (task.catchupCommitStarted = true)
            );
            task.catchupFinalized = {
                ...finalized,
                filePath: reservation.path,
            };
            fileSize = finalized.size;
        } else {
            fileSize = await finalizePartialDownload(
                reservation,
                progress.bytesDownloaded
            );
        }
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
        `[Downloads] Error finalizing ${reservation.filename}:`,
        // The transfer itself completed, so its byte count IS the total —
        // recording it lets Retry finalize the proven partial directly.
        true
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
        `[Downloads] Error downloading ${task.fileName}:`,
        // An interrupted or unverified transfer must keep an unknown total
        // unknown: fabricating one equal to the partial's size would let
        // Retry's completed-partial shortcut finalize unverified bytes
        // without a request.
        false
    );
}

async function persistRetainedPartialFailure(
    db: DownloadsDatabase,
    task: DownloadTask,
    fileName: string,
    filePath: string,
    progress: TransferProgress,
    error: unknown,
    logMessage: string,
    fallbackTotalToBytes: boolean
): Promise<void> {
    console.error(logMessage, describeError(error));
    const totalBytes =
        progress.totalBytes ??
        (fallbackTotalToBytes ? progress.bytesDownloaded : null);
    task.totalBytes = totalBytes;
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: progress.bytesDownloaded,
            errorMessage: describeError(error),
            fileName,
            filePath,
            // The task's validator is only ever proven-or-original, so a
            // validator promoted mid-attempt (complete overlap match)
            // survives into manual Retry instead of forcing a re-verify.
            resumeValidator: task.resumeValidator ?? null,
            status: 'failed',
            totalBytes,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
}

export async function getExistingCompletedFileProgress(
    task: DownloadTask
): Promise<CompletedPartialProgress | null> {
    if (task.catchup) return recoverCatchupCompletion(task);
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
    if (task.catchup) return null;
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

export { removePartialFile } from './download-file-finalize';
