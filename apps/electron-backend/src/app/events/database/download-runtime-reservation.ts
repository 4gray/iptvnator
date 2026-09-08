import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import {
    readArchiveFinalizations,
    verifiedArchiveSize,
} from './download-catchup-journal';
import { cleanupStoredCatchupFinal } from './download-catchup-removal';
import {
    reserveFreshCatchupTarget,
    reserveOwnedCatchupTarget,
} from './download-catchup-reservation';
import {
    findAvailableFinalPath,
    getPartialDownloadPath,
    reserveAvailablePartialDownloadFile,
    type ReservedPartialDownloadFile,
} from './download-file-path';
import type { DownloadsDatabase, DownloadTask } from './download-task';

export async function reserveTarget(
    db: DownloadsDatabase,
    task: DownloadTask
): Promise<ReservedPartialDownloadFile> {
    if (task.filePath) {
        if (task.catchup) {
            const proof = (await readArchiveFinalizations(db, [task.id])).get(
                task.id
            );
            if (
                proof &&
                proof.phase !== 'transfer' &&
                verifiedArchiveSize(task.filePath, proof) === null &&
                !(await cleanupStoredCatchupFinal(db, task.id, task.filePath))
            ) {
                throw new Error(
                    'Could not clean the interrupted archive promotion'
                );
            }
        }
        if (!existsSync(task.filePath)) {
            return {
                filename: task.fileName,
                partialPath: getPartialDownloadPath(task.filePath),
                path: task.filePath,
            };
        }

        if (task.catchup) return reserveFreshCatchupTarget(db, task);

        // Something now occupies the recorded destination — possibly a file
        // the user created while this download was paused or failed. Never
        // inspect or delete it: move the retained .part to the next free
        // numbered destination and finalize there instead.
        const redirected = findAvailableFinalPath(task.filePath);
        const currentPartial = getPartialDownloadPath(task.filePath);
        const redirectedPartial = getPartialDownloadPath(redirected.path);
        if (existsSync(currentPartial)) {
            await rename(currentPartial, redirectedPartial);
        }

        return {
            filename: redirected.filename,
            partialPath: redirectedPartial,
            path: redirected.path,
        };
    }

    return task.catchup
        ? reserveOwnedCatchupTarget(db, task)
        : reserveAvailablePartialDownloadFile(task.directory, task.fileName);
}
