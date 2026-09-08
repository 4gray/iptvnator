import { lstatSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ArchiveDownloadProof } from './download-catchup-journal';

/** Retry a journaled private capture without ever deleting a replacement. */
export function cleanupArchiveCapture(
    proof: ArchiveDownloadProof | undefined
): void {
    const path = proof?.partialCleanupPath;
    if (!path || !proof) return;
    try {
        const file = lstatSync(path);
        if (
            file.isFile() &&
            file.dev === proof.partialIdentity.dev &&
            file.ino === proof.partialIdentity.ino
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
