import { eq, sql } from 'drizzle-orm';
import * as schema from '../../database/schema';
import { cleanupStoredCatchupPartial } from './download-catchup-removal';
import { getPausedByteCount, removePartialFile } from './download-finalize';
import type { DownloadsDatabase, DownloadTask } from './download-task';

export async function persistCancellation(
    db: DownloadsDatabase,
    task: DownloadTask
): Promise<void> {
    console.log(`[Downloads] Canceled: ${task.fileName}`);
    const removed = task.catchup
        ? await cleanupStoredCatchupPartial(db, task.id, task.filePath, true)
        : removePartialFile(task.filePath);
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

export async function persistPause(
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
                // Keep a mid-attempt validator promotion (complete overlap
                // match) across pause/resume.
                resumeValidator: task.resumeValidator ?? null,
                status: 'paused',
                totalBytes: task.totalBytes ?? null,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));
    } catch (error) {
        console.error('[Downloads] Failed to persist pause:', error);
    }
}
export async function persistQueuedCancellation(
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
