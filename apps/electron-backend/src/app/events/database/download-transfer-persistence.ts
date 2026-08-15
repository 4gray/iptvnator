import { eq, sql } from 'drizzle-orm';
import * as schema from '../../database/schema';
import { broadcastDownloadUpdate } from './download-broadcast';
import type {
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';

export async function persistTransferStart(
    db: DownloadsDatabase,
    task: DownloadTask,
    bytesDownloaded: number,
    totalBytes: number | null
): Promise<void> {
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded,
            resumeValidator: task.resumeValidator ?? null,
            totalBytes,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
    broadcastDownloadUpdate();
}

export async function persistProgress(
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
