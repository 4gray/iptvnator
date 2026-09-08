import { cleanupArchiveCapture } from './download-catchup-capture';
import {
    lstatSync,
    type Stats,
    mkdtempSync,
    renameSync,
    linkSync,
    unlinkSync,
    rmdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
    readArchiveFinalizations,
    recordArchiveCleanupPath,
    type ArchiveDownloadProof,
} from './download-catchup-journal';
import type { DownloadsDatabase } from './download-task';
import type { ArchiveFileIdentity } from './download-catchup-output';

/** IPC removal stays synchronous after its runtime guard, like VOD cleanup. */
export function removeJournaledCatchupPartial(
    filePath: string | null,
    proof: ArchiveDownloadProof | undefined,
    recordCapture: (path: string) => void
): void {
    // No proof means no authority to remove the retained entry.
    if (!filePath || !proof || proof.filePath !== filePath) return;
    cleanupArchiveCapture(proof);
    const path = `${filePath}.part`;
    const matches = (file: Stats, identity: ArchiveFileIdentity) =>
        file.isFile() && file.dev === identity.dev && file.ino === identity.ino;
    try {
        if (!matches(lstatSync(path), proof.partialIdentity)) return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
    const directory = mkdtempSync(join(dirname(path), '.iptvnator-cleanup-'));
    const captured = join(directory, 'entry');
    try {
        recordCapture(captured);
        renameSync(path, captured);
        if (matches(lstatSync(captured), proof.partialIdentity)) {
            unlinkSync(captured);
        } else {
            try {
                linkSync(captured, path);
                unlinkSync(captured);
            } catch {
                console.warn(
                    '[Downloads] Replaced file retained for recovery:',
                    captured
                );
            }
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
    filePath: string | null | undefined
): Promise<boolean> {
    if (!filePath) return true;
    try {
        const proof = (await readArchiveFinalizations(db, [downloadId])).get(
            downloadId
        );
        removeJournaledCatchupPartial(filePath, proof, (path) => {
            if (proof) recordArchiveCleanupPath(db, downloadId, proof, path);
        });
        return true;
    } catch (error) {
        console.error(
            '[Downloads] Failed to clean canceled archive partial:',
            error
        );
        return false;
    }
}
