import { lstatSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ArchiveFileIdentity } from './download-catchup-output';
import type { ArchiveDownloadProof } from './download-catchup-journal';

/** Retry a journaled private capture without ever deleting a replacement. */
export function cleanupArchiveCapture(
    proof: ArchiveDownloadProof | undefined
): void {
    if (!proof) return;
    cleanupCapture(proof.partialCleanupPath, proof.partialIdentity);
    if (proof.phase !== 'transfer')
        cleanupCapture(proof.finalCleanupPath, proof.finalIdentity);
}

function cleanupCapture(
    path: string | undefined,
    identity: ArchiveFileIdentity
): void {
    if (!path) return;
    try {
        const file = lstatSync(path);
        if (
            file.isFile() &&
            file.dev === identity.dev &&
            file.ino === identity.ino
        ) {
            unlinkSync(path);
        } else {
            console.warn(
                '[Downloads] Replaced file retained for recovery:',
                path
            );
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
        rmdirSync(dirname(path));
    } catch {
        /* never recursively delete captures */
    }
}
