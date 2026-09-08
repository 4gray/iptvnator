import { finalizeCatchupPartial } from './download-catchup-finalize';
import { recordArchiveFinalization } from './download-catchup-journal';
import {
    cleanupStoredCatchupPartial,
    cleanupStoredCatchupFinal,
} from './download-catchup-removal';
import type { ReservedPartialDownloadFile } from './download-file-path';
import type {
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';

export async function promoteCatchupDownload(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile,
    progress: TransferProgress
): Promise<number> {
    const partialIdentity = task.catchupPartialIdentity;
    if (!partialIdentity)
        throw new Error('Archive transfer identity is unavailable');
    const finalized = await finalizeCatchupPartial(
        reservation,
        partialIdentity,
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
        () => (task.catchupCommitStarted = true),
        {
            partial: () =>
                cleanupStoredCatchupPartial(db, task.id, reservation.path),
            final: (identity) =>
                cleanupStoredCatchupFinal(
                    db,
                    task.id,
                    reservation.path,
                    identity
                ),
        }
    );
    task.catchupFinalized = { ...finalized, filePath: reservation.path };
    return finalized.size;
}
