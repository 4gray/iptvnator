import { inArray, sql } from 'drizzle-orm';
import { statSync } from 'node:fs';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import {
    getPartialDownloadSize,
    removePartialDownloadFile,
} from './download-file-path';

interface StaleDownload {
    filePath: string | null;
    id: number;
    status: string;
    totalBytes: number | null;
}

function getRecoverablePartialSize(download: StaleDownload): number {
    if (
        (download.status !== 'downloading' && download.status !== 'queued') ||
        !download.filePath
    ) {
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

/**
 * A crash between finalizePartialDownload() and persistCompletion() leaves a
 * 'downloading' row whose .part is gone but whose final file is fully on
 * disk. Recognize that file (size must match the recorded total) so recovery
 * commits the completion instead of orphaning the file and re-downloading.
 */
function getFinalizedFileSize(download: StaleDownload): number | null {
    if (
        download.status !== 'downloading' ||
        !download.filePath ||
        download.totalBytes === null
    ) {
        return null;
    }

    try {
        const stats = statSync(download.filePath);
        return stats.isFile() && stats.size === download.totalBytes
            ? stats.size
            : null;
    } catch {
        return null;
    }
}

function removeFailedPartial(download: StaleDownload): boolean {
    if (!download.filePath) {
        return true;
    }

    try {
        removePartialDownloadFile(download.filePath);
        return true;
    } catch (error) {
        console.error(
            '[Downloads] Failed to delete interrupted partial file:',
            download.filePath,
            error
        );
        return false;
    }
}

function removeCompletedPartial(download: StaleDownload): void {
    if (!download.filePath) {
        return;
    }

    try {
        removePartialDownloadFile(download.filePath);
    } catch (error) {
        console.error(
            '[Downloads] Failed to delete completed partial file:',
            download.filePath,
            error
        );
    }
}

export async function resetStaleDownloads(): Promise<void> {
    try {
        const db = await getDatabase();
        const downloads = await db
            .select({
                filePath: schema.downloads.filePath,
                id: schema.downloads.id,
                status: schema.downloads.status,
                totalBytes: schema.downloads.totalBytes,
            })
            .from(schema.downloads)
            .where(
                inArray(schema.downloads.status, [
                    'queued',
                    'downloading',
                    'completed',
                ])
            );
        const completedDownloads = downloads.filter(
            (download) => download.status === 'completed'
        );
        const staleDownloads = downloads.filter(
            (download) => download.status !== 'completed'
        );
        const finalizedDownloads = staleDownloads
            .map((download) => ({
                ...download,
                finalizedSize: getFinalizedFileSize(download),
            }))
            .filter((download) => download.finalizedSize !== null);
        const finalizedIds = new Set(
            finalizedDownloads.map((download) => download.id)
        );
        // Queued rows are recoverable even without partial bytes: a resumed
        // download waiting behind an active one is persisted as 'queued' with
        // its retained .part, and a never-started queued row loses nothing by
        // becoming 'paused' instead of 'failed'.
        const recoverableDownloads = staleDownloads
            .filter((download) => !finalizedIds.has(download.id))
            .map((download) => ({
                ...download,
                bytesDownloaded: getRecoverablePartialSize(download),
            }))
            .filter(
                (download) =>
                    download.status === 'queued' || download.bytesDownloaded > 0
            );
        const recoverableIds = new Set(
            recoverableDownloads.map((download) => download.id)
        );
        const failedDownloads = staleDownloads.filter(
            (download) =>
                !recoverableIds.has(download.id) &&
                !finalizedIds.has(download.id)
        );
        const cleanupResult = failedDownloads.map((download) => ({
            ...download,
            partialRemoved: removeFailedPartial(download),
        }));
        const failedIdsWithRemovedPartials = cleanupResult
            .filter((download) => download.partialRemoved)
            .map((download) => download.id);
        const failedIdsWithRetainedPartials = cleanupResult
            .filter((download) => !download.partialRemoved)
            .map((download) => download.id);

        completedDownloads.forEach(removeCompletedPartial);

        for (const download of finalizedDownloads) {
            // The interrupted commit may also have left the .part behind.
            removeCompletedPartial(download);
            await db
                .update(schema.downloads)
                .set({
                    bytesDownloaded: download.finalizedSize,
                    errorMessage: null,
                    status: 'completed',
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(inArray(schema.downloads.id, [download.id]));
        }

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

        if (failedIdsWithRemovedPartials.length > 0) {
            await db
                .update(schema.downloads)
                .set({
                    errorMessage: 'Download interrupted by application restart',
                    filePath: null,
                    status: 'failed',
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(inArray(schema.downloads.id, failedIdsWithRemovedPartials));
        }

        if (failedIdsWithRetainedPartials.length > 0) {
            await db
                .update(schema.downloads)
                .set({
                    errorMessage: 'Download interrupted by application restart',
                    status: 'failed',
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(inArray(schema.downloads.id, failedIdsWithRetainedPartials));
        }

        console.log('[Downloads] Reset stale downloads');
    } catch (error) {
        console.error('[Downloads] Error resetting stale downloads:', error);
    }
}
