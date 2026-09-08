import { lstat } from 'node:fs/promises';
import { cleanupCatchupPartial } from './download-catchup-cleanup';
import { clearArchiveFinalization } from './download-catchup-journal';
import { ArchivePartialReplacedError } from './download-catchup-output';
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
                partial.dev !== expected.dev ||
                partial.ino !== expected.ino)
        ) {
            throw new ArchivePartialReplacedError();
        }
        if (!(await cleanupCatchupPartial(task.filePath, expected))) {
            throw new Error('Could not remove the owned archive partial');
        }
    }
    await clearArchiveFinalization(db, task.id);
    task.catchupExpectedPartialIdentity = undefined;
    return reserveAvailablePartialDownloadFile(task.directory, task.fileName);
}
