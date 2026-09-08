import { readArchiveStats } from './download-catchup-stats';
import { link, mkdtemp, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
    sameArchiveFileIdentity,
    type ArchiveFileIdentity,
} from './download-catchup-output';

/** Capture the directory entry atomically before inspecting or removing it. */
export async function cleanupCatchupFile(
    path: string,
    identity: ArchiveFileIdentity
): Promise<void> {
    // mkdtemp creates an unpredictable, private directory on the same volume.
    // Other writers of the public .part/final path cannot race this entry.
    const directory = await mkdtemp(join(dirname(path), '.iptvnator-cleanup-'));
    const captured = join(directory, 'entry');
    try {
        await rename(path, captured);
        const stats = await readArchiveStats(captured);
        if (stats.isFile() && sameArchiveFileIdentity(stats, identity)) {
            await unlink(captured);
        } else {
            // A replacement was captured. Restore without clobbering any newer
            // public entry. If restoration is unavailable, retain it privately.
            try {
                await link(captured, path);
                throw new Error(
                    `Archive cleanup preserved an unrelated recovery file: ${captured}`
                );
            } catch (error) {
                console.warn(
                    '[Downloads] Replaced file retained for recovery:',
                    captured
                );
                throw error;
            }
        }
    } finally {
        // Never recursively remove the quarantine: it may hold a replacement or
        // a file whose verification/cleanup failed. Empty directories only.
        await rmdir(directory).catch(() => undefined);
    }
}

/** Failed/canceled transfers may only remove the partial that they opened. */
export async function cleanupCatchupPartial(
    filePath: string | null | undefined,
    identity: ArchiveFileIdentity | undefined
): Promise<boolean> {
    if (!filePath) return true;
    const path = filePath + '.part';
    try {
        if (identity) await cleanupCatchupFile(path, identity);
        await readArchiveStats(path);
        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT';
    }
}
