import { ArchiveRecoveryRequiredError } from './download-catchup-capture';
import { and, eq, inArray } from 'drizzle-orm';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import {
    readArchiveFinalizations,
    verifiedArchiveSize,
    recordArchiveCleanupPath,
} from './download-catchup-journal';
import { removeJournaledCatchupPartial } from './download-catchup-removal';
import { removePartialDownloadFile } from './download-file-path';
import {
    broadcastDownloadUpdate,
    isDownloadCommitting,
    hasRuntimeDownload,
    prepareArchiveRemoval,
    removeDownloadFromRuntime,
} from './download-runtime';

const removablePartialStatuses = new Set([
    'queued',
    'paused',
    'completed',
    'failed',
    'canceled',
]);

export async function removeDownloadRequest(downloadId: number) {
    try {
        if (!(await prepareArchiveRemoval(downloadId)))
            return {
                success: false,
                error: 'Download is completing; try again shortly',
            };
        console.log('[Downloads] Remove download:', downloadId);
        const db = await getDatabase();
        const rows = await db
            .select({
                filePath: schema.downloads.filePath,
                contentType: schema.downloads.contentType,
                status: schema.downloads.status,
            })
            .from(schema.downloads)
            .where(eq(schema.downloads.id, downloadId))
            .limit(1);
        const row = rows[0];
        const proof =
            row?.contentType === 'catchup'
                ? (await readArchiveFinalizations(db, [downloadId])).get(
                      downloadId
                  )
                : undefined;
        if (
            isDownloadCommitting(downloadId) ||
            (row?.contentType === 'catchup' && hasRuntimeDownload(downloadId))
        )
            return {
                success: false,
                error: 'Download is completing; try again shortly',
            };
        // A settled archive can still say downloading when its cancellation
        // status write failed. Its journal must be drained before row deletion.
        if (
            row?.filePath &&
            (row.contentType === 'catchup' ||
                removablePartialStatuses.has(row.status))
        ) {
            try {
                if (row.contentType === 'catchup')
                    removeJournaledCatchupPartial(
                        row.filePath,
                        proof,
                        (path, kind) => {
                            if (proof)
                                recordArchiveCleanupPath(
                                    db,
                                    downloadId,
                                    proof,
                                    path,
                                    kind
                                );
                        },
                        row.status !== 'completed' &&
                            verifiedArchiveSize(row.filePath, proof) === null
                    );
                else removePartialDownloadFile(row.filePath);
            } catch (cleanupError) {
                // Keep the row (and its runtime entry) so the .part is never
                // orphaned, but answer with a structured failure the UI can
                // surface instead of an opaque IPC rejection. Retrying the
                // remove re-attempts the deletion.
                console.error(
                    '[Downloads] Failed to delete partial file on remove:',
                    row.filePath,
                    cleanupError
                );
                return {
                    error: 'Could not delete the partial file',
                    ...(cleanupError instanceof ArchiveRecoveryRequiredError
                        ? { recoveryPath: cleanupError.recoveryPath }
                        : {}),
                    success: false,
                };
            }
        }
        if (removeDownloadFromRuntime(downloadId) === false)
            return {
                success: false,
                error: 'Download is completing; try again shortly',
            };
        await db
            .delete(schema.downloads)
            .where(eq(schema.downloads.id, downloadId));
        broadcastDownloadUpdate();
        return { success: true };
    } catch (error) {
        console.error('[Downloads] Error removing download:', error);
        throw error;
    }
}

export async function clearCompletedDownloadsRequest(playlistId?: string) {
    try {
        const db = await getDatabase();
        const terminalStatus = inArray(schema.downloads.status, [
            'completed',
            'failed',
            'canceled',
        ]);
        const terminalFilter = playlistId
            ? and(eq(schema.downloads.playlistId, playlistId), terminalStatus)
            : terminalStatus;
        const rows = await db
            .select({
                id: schema.downloads.id,
                filePath: schema.downloads.filePath,
                contentType: schema.downloads.contentType,
                status: schema.downloads.status,
            })
            .from(schema.downloads)
            .where(terminalFilter);
        const proofs = await readArchiveFinalizations(
            db,
            rows
                .filter((row) => row.contentType === 'catchup')
                .map((row) => row.id)
        );
        const downloadIdsToDelete: number[] = [];
        let recoveryPath: string | undefined;
        for (const row of rows) {
            if (hasRuntimeDownload(row.id)) continue;
            if (row.filePath && removablePartialStatuses.has(row.status)) {
                try {
                    if (row.contentType === 'catchup')
                        removeJournaledCatchupPartial(
                            row.filePath,
                            proofs.get(row.id),
                            (path, kind) => {
                                const proof = proofs.get(row.id);
                                if (proof)
                                    recordArchiveCleanupPath(
                                        db,
                                        row.id,
                                        proof,
                                        path,
                                        kind
                                    );
                            },
                            row.status !== 'completed' &&
                                verifiedArchiveSize(
                                    row.filePath,
                                    proofs.get(row.id)
                                ) === null
                        );
                    else removePartialDownloadFile(row.filePath);
                } catch (error) {
                    if (error instanceof ArchiveRecoveryRequiredError)
                        recoveryPath ??= error.recoveryPath;
                    console.error(
                        '[Downloads] Retaining download after partial cleanup failed:',
                        error
                    );
                    continue;
                }
            }
            downloadIdsToDelete.push(row.id);
        }
        if (downloadIdsToDelete.length > 0) {
            await db
                .delete(schema.downloads)
                .where(
                    and(
                        terminalFilter,
                        inArray(schema.downloads.id, downloadIdsToDelete)
                    )
                );
            broadcastDownloadUpdate();
        }
        return recoveryPath
            ? { success: false, recoveryPath }
            : { success: true };
    } catch (error) {
        console.error('[Downloads] Error clearing completed:', error);
        throw error;
    }
}
