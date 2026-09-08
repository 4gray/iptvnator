import {
    readArchiveStatsSync,
    type ArchiveFileStats,
} from './download-catchup-stats';
import {
    cleanupArchiveCapture,
    restoreArchiveReplacement,
} from './download-catchup-capture';
import { mkdtempSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
    readArchiveFinalizations,
    verifiedArchiveSize,
    recordArchiveCleanupPath,
    type ArchiveDownloadProof,
} from './download-catchup-journal';
import type { DownloadsDatabase } from './download-task';
import {
    sameArchiveFileIdentity,
    type ArchiveFileIdentity,
} from './download-catchup-output';

/** IPC removal stays synchronous after its runtime guard, like VOD cleanup. */
export function removeJournaledCatchupPartial(
    filePath: string | null,
    proof: ArchiveDownloadProof | undefined,
    recordCapture: (path: string, kind?: 'partial' | 'final') => void,
    removeFinal = false
): void {
    // No proof means no authority to remove the retained entry.
    if (!filePath || !proof || proof.filePath !== filePath) return;
    cleanupArchiveCapture(proof);
    if (removeFinal && proof.phase !== 'transfer')
        removeOwnedEntry(filePath, proof.finalIdentity, (path) =>
            recordCapture(path, 'final')
        );
    removeOwnedEntry(`${filePath}.part`, proof.partialIdentity, (path) =>
        recordCapture(path, 'partial')
    );
}

function removeOwnedEntry(
    path: string,
    identity: ArchiveFileIdentity,
    recordCapture: (path: string) => void
): void {
    const matches = (file: ArchiveFileStats, identity: ArchiveFileIdentity) =>
        file.isFile() && sameArchiveFileIdentity(file, identity);
    try {
        if (!matches(readArchiveStatsSync(path), identity)) return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
    const directory = mkdtempSync(join(dirname(path), '.iptvnator-cleanup-'));
    const captured = join(directory, 'entry');
    try {
        recordCapture(captured);
        renameSync(path, captured);
        if (matches(readArchiveStatsSync(captured), identity)) {
            unlinkSync(captured);
        } else {
            restoreArchiveReplacement(captured, path);
        }
    } finally {
        try {
            rmdirSync(directory);
        } catch {
            /* never recursively remove a capture */
        }
    }
}

/** Queue/paused cancellation uses the same durable ownership as explicit Remove. */
export async function cleanupStoredCatchupPartial(
    db: DownloadsDatabase,
    downloadId: number,
    filePath: string | null | undefined,
    removeFinal: boolean | 'incomplete' = false
): Promise<boolean> {
    if (!filePath) return true;
    try {
        const proof = (await readArchiveFinalizations(db, [downloadId])).get(
            downloadId
        );
        removeJournaledCatchupPartial(
            filePath,
            proof,
            (path, kind) => {
                if (proof)
                    recordArchiveCleanupPath(db, downloadId, proof, path, kind);
            },
            removeFinal === true ||
                (removeFinal === 'incomplete' &&
                    verifiedArchiveSize(filePath, proof) === null)
        );
        return true;
    } catch (error) {
        console.error(
            '[Downloads] Failed to clean canceled archive partial:',
            error
        );
        return false;
    }
}

/** Failed promotion/startup cleanup retains every owned nonempty final capture. */
export async function cleanupStoredCatchupFinal(
    db: DownloadsDatabase,
    downloadId: number,
    filePath: string,
    createdIdentity?: ArchiveFileIdentity
): Promise<boolean> {
    try {
        const proof = (await readArchiveFinalizations(db, [downloadId])).get(
            downloadId
        );
        if (
            !proof ||
            proof.phase === 'transfer' ||
            proof.filePath !== filePath ||
            (createdIdentity &&
                !sameArchiveFileIdentity(createdIdentity, proof.finalIdentity))
        ) {
            // No copy bytes precede final proof. Preserve an unproved empty
            // destination in place: relocation needs a durable capture pointer.
            return !createdIdentity;
        }
        cleanupArchiveCapture(proof);
        removeOwnedEntry(filePath, proof.finalIdentity, (path) =>
            recordArchiveCleanupPath(db, downloadId, proof, path, 'final')
        );
        return true;
    } catch (error) {
        console.error('[Downloads] Failed to clean archive promotion:', error);
        return false;
    }
}
