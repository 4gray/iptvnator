import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../database/schema';
import { broadcastDownloadUpdate } from './download-broadcast';
import {
    readArchiveFinalizations,
    recordArchiveCleanupPath,
    verifiedArchiveSize,
} from './download-catchup-journal';
import { removeJournaledCatchupPartial } from './download-catchup-removal';
import type { DownloadsDatabase } from './download-task';

/** Restore a proven final before a user request can detach it or transfer again. */
export async function recoverStoredCatchupCompletion(
    db: DownloadsDatabase,
    item: Pick<schema.Download, 'id' | 'contentType' | 'filePath' | 'status'>,
    isBusy: () => boolean
): Promise<boolean> {
    if (item.contentType !== 'catchup' || !item.filePath) return false;
    const proof = (await readArchiveFinalizations(db, [item.id])).get(item.id);
    const assertIdle = () => {
        if (isBusy()) throw new Error('Download already in progress');
    };
    assertIdle();
    const size = verifiedArchiveSize(item.filePath, proof);
    if (size === null) return false;
    // A failed source cleanup keeps its journal for later Remove/Clear retry.
    try {
        removeJournaledCatchupPartial(item.filePath, proof, (path) => {
            if (proof) recordArchiveCleanupPath(db, item.id, proof, path);
        });
    } catch (error) {
        console.error(
            '[Downloads] Retaining recovered archive cleanup for retry:',
            error
        );
    }
    if (verifiedArchiveSize(item.filePath, proof) !== size) return false;
    const result = await db
        .update(schema.downloads)
        .set({
            status: 'completed',
            bytesDownloaded: size,
            totalBytes: size,
            errorMessage: null,
            resumeValidator: null,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(
            and(
                eq(schema.downloads.id, item.id),
                eq(schema.downloads.status, item.status),
                eq(schema.downloads.filePath, item.filePath)
            )
        );
    if (result && 'changes' in result && result.changes === 0)
        throw new Error('Download changed during completion recovery');
    broadcastDownloadUpdate();
    return true;
}
