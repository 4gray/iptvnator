import { closeSync, fstatSync, openSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { cleanupCatchupPartial } from './download-catchup-cleanup';
import { cleanupStoredCatchupPartial } from './download-catchup-removal';
import {
    clearArchiveFinalization,
    recordArchiveReservation,
} from './download-catchup-journal';
import {
    ArchivePartialReplacedError,
    archiveFileIdentity,
    sameArchiveFileIdentity,
} from './download-catchup-output';
import { reserveAvailablePartialDownloadFile } from './download-file-path';
import type { DownloadsDatabase, DownloadTask } from './download-task';

/** Archives restart at zero, so never relocate a retained entry on collision. */
export async function reserveFreshCatchupTarget(
    db: DownloadsDatabase,
    task: DownloadTask
) {
    if (task.filePath) {
        const partial = await lstat(`${task.filePath}.part`).catch(
            (error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return undefined;
                throw error;
            }
        );
        const expected = task.catchupExpectedPartialIdentity;
        if (
            partial &&
            (!expected ||
                !partial.isFile() ||
                !sameArchiveFileIdentity(partial, expected))
        ) {
            throw new ArchivePartialReplacedError();
        }
        if (!(await cleanupStoredCatchupPartial(db, task.id, task.filePath))) {
            throw new Error('Could not remove the owned archive partial');
        }
    }
    await clearArchiveFinalization(db, task.id);
    return reserveOwnedCatchupTarget(db, task);
}

/** Capture ownership from the exclusive creation descriptor, before any network wait. */
export async function reserveOwnedCatchupTarget(
    db: DownloadsDatabase,
    task: DownloadTask
) {
    task.catchupExpectedPartialIdentity = undefined;
    const reservation = reserveAvailablePartialDownloadFile(
        task.directory,
        task.fileName,
        (partialPath) => {
            const descriptor = openSync(partialPath, 'wx', 0o600);
            try {
                task.catchupExpectedPartialIdentity = archiveFileIdentity(
                    fstatSync(descriptor)
                );
            } finally {
                closeSync(descriptor);
            }
        }
    );
    task.filePath = reservation.path;
    task.fileName = reservation.filename;
    const identity = task.catchupExpectedPartialIdentity;
    if (!identity)
        throw new Error('Archive reservation identity is unavailable');
    try {
        await recordArchiveReservation(
            db,
            task.id,
            reservation.path,
            identity,
            reservation.filename
        );
    } catch (error) {
        // No media bytes have been written. Without a usable journal, remove
        // only the empty reservation whose identity came from our descriptor.
        await cleanupCatchupPartial(reservation.path, identity);
        throw error;
    }
    return reservation;
}
