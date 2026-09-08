import { link, lstat, mkdtemp, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ArchiveFileIdentity } from './download-catchup-output';

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
        const stats = await lstat(captured);
        if (
            stats.isFile() &&
            stats.dev === identity.dev &&
            stats.ino === identity.ino
        ) {
            await unlink(captured);
        } else {
            // A replacement was captured. Restore without clobbering any newer
            // public entry. If restoration is unavailable, retain it privately.
            try {
                await link(captured, path);
                await unlink(captured);
            } catch {
                console.warn(
                    '[Downloads] Replaced file retained for recovery:',
                    captured
                );
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
        await lstat(path);
        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT';
    }
}
