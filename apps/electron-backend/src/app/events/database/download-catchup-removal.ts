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
import type { ArchiveDownloadProof } from './download-catchup-journal';
import type { ArchiveFileIdentity } from './download-catchup-output';

/** IPC removal stays synchronous after its runtime guard, like VOD cleanup. */
export function removeJournaledCatchupPartial(
    filePath: string | null,
    proof: ArchiveDownloadProof | undefined
): void {
    // No proof means no authority to remove the retained entry.
    if (!filePath || !proof || proof.filePath !== filePath) return;
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
    } catch (error) {
        // Keep owned files reachable for another Remove attempt after I/O errors.
        try {
            linkSync(captured, path);
            unlinkSync(captured);
        } catch {
            console.warn(
                '[Downloads] Partial retained for recovery:',
                captured
            );
        }
        throw error;
    } finally {
        try {
            rmdirSync(directory);
        } catch {
            /* never recursively remove a capture */
        }
    }
}
