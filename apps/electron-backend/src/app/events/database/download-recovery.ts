import { readArchiveStatsSync } from './download-catchup-stats';
import { sameArchiveFileIdentity } from './download-catchup-output';
import {
    cleanupStoredCatchupPartial,
    cleanupStoredCatchupFinal,
} from './download-catchup-removal';
import type { DownloadsDatabase } from './download-task';
import {
    readArchiveFinalizations,
    verifiedArchiveSize,
    type ArchiveDownloadProof,
} from './download-catchup-journal';
import { inArray, sql } from 'drizzle-orm';
import { statSync } from 'node:fs';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import {
    getPartialDownloadSize,
    removePartialDownloadFile,
} from './download-file-path';

interface StaleDownload {
    contentType?: string;
    proof?: ArchiveDownloadProof;
    filePath: string | null;
    id: number;
    status: string;
    totalBytes: number | null;
}

/** A journaled source cannot be adopted again after an unrelated replacement. */
function hasReplacedArchivePartial(download: StaleDownload): boolean {
    if (
        download.contentType !== 'catchup' ||
        !download.proof ||
        !download.filePath
    )
        return false;
    try {
        const file = readArchiveStatsSync(`${download.filePath}.part`);
        const expected = download.proof.partialIdentity;
        return !file.isFile() || !sameArchiveFileIdentity(file, expected);
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
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
    if (download.contentType === 'catchup')
        return download.status === 'downloading'
            ? verifiedArchiveSize(download.filePath, download.proof)
            : null;
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

async function removeFailedPartial(
    db: DownloadsDatabase,
    download: StaleDownload
): Promise<boolean> {
    if (download.contentType === 'catchup')
        return cleanupStoredCatchupPartial(
            db,
            download.id,
            download.filePath,
            true
        );
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

async function removeCompletedPartial(
    db: DownloadsDatabase,
    download: StaleDownload
): Promise<void> {
    if (download.contentType === 'catchup') {
        await cleanupStoredCatchupPartial(db, download.id, download.filePath);
        return;
    }
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
        const rows = await db
            .select({
                filePath: schema.downloads.filePath,
                contentType: schema.downloads.contentType,
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
        const proofs = await readArchiveFinalizations(
            db,
            rows
                .filter((row) => row.contentType === 'catchup')
                .map((row) => row.id)
        );
        const downloads = rows.map((row) => {
            const proof = proofs.get(row.id);
            return {
                ...row,
                proof: proof?.filePath === row.filePath ? proof : undefined,
            };
        });
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
        // A killed copy may have left an incomplete owned destination. Remove
        // only that journal-bound entry before resuming the retained source.
        for (const download of staleDownloads) {
            if (
                download.contentType === 'catchup' &&
                download.proof &&
                download.proof.phase !== 'transfer' &&
                !finalizedIds.has(download.id) &&
                verifiedArchiveSize(download.filePath, download.proof) === null
            ) {
                await cleanupStoredCatchupFinal(
                    db,
                    download.id,
                    download.proof.filePath
                );
            }
        }
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
                    !hasReplacedArchivePartial(download) &&
                    (download.status === 'queued' ||
                        download.bytesDownloaded > 0)
            );
        const recoverableIds = new Set(
            recoverableDownloads.map((download) => download.id)
        );
        const failedDownloads = staleDownloads.filter(
            (download) =>
                !recoverableIds.has(download.id) &&
                !finalizedIds.has(download.id)
        );
        const cleanupResult = await Promise.all(
            failedDownloads.map(async (download) => ({
                ...download,
                // Detach a known replacement without touching it. A later retry
                // reserves another path instead of truncating the unrelated file.
                partialRemoved:
                    hasReplacedArchivePartial(download) ||
                    (await removeFailedPartial(db, download)),
            }))
        );
        const failedIdsWithRemovedPartials = cleanupResult
            .filter((download) => download.partialRemoved)
            .map((download) => download.id);
        const failedIdsWithRetainedPartials = cleanupResult
            .filter((download) => !download.partialRemoved)
            .map((download) => download.id);

        await Promise.all(
            completedDownloads.map((download) =>
                removeCompletedPartial(db, download)
            )
        );

        for (const download of finalizedDownloads) {
            // The interrupted commit may also have left the .part behind.
            await removeCompletedPartial(db, download);
            await db
                .update(schema.downloads)
                .set({
                    bytesDownloaded: download.finalizedSize,
                    totalBytes: download.finalizedSize,
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
                .where(
                    inArray(schema.downloads.id, failedIdsWithRemovedPartials)
                );
        }

        if (failedIdsWithRetainedPartials.length > 0) {
            await db
                .update(schema.downloads)
                .set({
                    errorMessage: 'Download interrupted by application restart',
                    status: 'failed',
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(
                    inArray(schema.downloads.id, failedIdsWithRetainedPartials)
                );
        }

        console.log('[Downloads] Reset stale downloads');
    } catch (error) {
        console.error('[Downloads] Error resetting stale downloads:', error);
    }
}
