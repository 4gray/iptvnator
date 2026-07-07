import { inArray, sql } from 'drizzle-orm';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { getPartialDownloadSize } from './download-file-path';

interface StaleDownload {
    filePath: string | null;
    id: number;
    status: string;
    totalBytes: number | null;
}

function getRecoverablePartialSize(download: StaleDownload): number {
    if (download.status !== 'downloading' || !download.filePath) {
        return 0;
    }

    try {
        return getPartialDownloadSize(download.filePath);
    } catch (error) {
        console.error(
            '[Downloads] Failed to inspect interrupted partial file:',
            error
        );
        return 0;
    }
}

export async function resetStaleDownloads(): Promise<void> {
    try {
        const db = await getDatabase();
        const staleDownloads = await db
            .select({
                filePath: schema.downloads.filePath,
                id: schema.downloads.id,
                status: schema.downloads.status,
                totalBytes: schema.downloads.totalBytes,
            })
            .from(schema.downloads)
            .where(inArray(schema.downloads.status, ['queued', 'downloading']));
        const recoverableDownloads = staleDownloads
            .map((download) => ({
                ...download,
                bytesDownloaded: getRecoverablePartialSize(download),
            }))
            .filter((download) => download.bytesDownloaded > 0);
        const recoverableIds = new Set(
            recoverableDownloads.map((download) => download.id)
        );
        const failedIds = staleDownloads
            .filter((download) => !recoverableIds.has(download.id))
            .map((download) => download.id);

        for (const download of recoverableDownloads) {
            await db
                .update(schema.downloads)
                .set({
                    bytesDownloaded: download.bytesDownloaded,
                    errorMessage: null,
                    status: 'paused',
                    totalBytes: download.totalBytes,
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(inArray(schema.downloads.id, [download.id]));
        }

        if (failedIds.length > 0) {
            await db
                .update(schema.downloads)
                .set({
                    errorMessage: 'Download interrupted by application restart',
                    filePath: null,
                    status: 'failed',
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(inArray(schema.downloads.id, failedIds));
        }

        console.log('[Downloads] Reset stale downloads');
    } catch (error) {
        console.error('[Downloads] Error resetting stale downloads:', error);
    }
}
