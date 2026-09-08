import { readArchiveStatsSync } from './download-catchup-stats';
import { linkSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import {
    sameArchiveFileIdentity,
    type ArchiveFileIdentity,
} from './download-catchup-output';
import type { ArchiveDownloadProof } from './download-catchup-journal';

export class ArchiveRecoveryRequiredError extends Error {
    constructor(
        readonly recoveryPath: string,
        reason?: unknown
    ) {
        super(
            `Archive cleanup preserved an unrelated recovery file: ${recoveryPath}${reason instanceof Error ? `. ${reason.message}` : ''}`
        );
    }
}

/** Retry a journaled private capture without ever deleting a replacement. */
export function cleanupArchiveCapture(
    proof: ArchiveDownloadProof | undefined
): void {
    if (!proof) return;
    cleanupCapture(
        proof.partialCleanupPath,
        proof.partialIdentity,
        proof.filePath + '.part'
    );
    if (proof.phase !== 'transfer')
        cleanupCapture(
            proof.finalCleanupPath,
            proof.finalIdentity,
            proof.filePath
        );
}

function cleanupCapture(
    path: string | undefined,
    identity: ArchiveFileIdentity,
    publicPath: string
): void {
    if (!path) return;
    let file;
    try {
        file = readArchiveStatsSync(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (file) {
        if (!(file.isFile() && sameArchiveFileIdentity(file, identity))) {
            restoreArchiveReplacement(path, publicPath);
        }
        unlinkSync(path);
    }
    try {
        rmdirSync(dirname(path));
    } catch {
        /* never recursively delete captures */
    }
}

/** Never unlink a foreign capture after publishing a raceable public link. */
export function restoreArchiveReplacement(
    captured: string,
    publicPath: string
): never {
    try {
        const file = readArchiveStatsSync(captured);
        try {
            linkSync(captured, publicPath);
        } catch (error) {
            if (
                (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
                !sameArchiveFileIdentity(readArchiveStatsSync(publicPath), file)
            )
                throw error;
        }
    } catch (error) {
        throw new ArchiveRecoveryRequiredError(captured, error);
    }
    // A second process can remove the public link at any time. Only an explicit
    // user cleanup of this recovery copy may release its durable journal entry.
    throw new ArchiveRecoveryRequiredError(captured);
}
