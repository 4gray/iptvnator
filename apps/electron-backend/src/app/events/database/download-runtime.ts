import { cleanupArchiveCapture } from './download-catchup-capture';
import { reserveTarget } from './download-runtime-reservation';
import {
    clearArchiveFinalization,
    readArchiveFinalizations,
} from './download-catchup-journal';
import { cleanupStoredCatchupPartial } from './download-catchup-removal';
import {
    persistCancellation,
    persistPause,
    persistQueuedCancellation,
} from './download-runtime-persistence';
import { transferCatchupToPartialFile } from './download-catchup-transfer';
import { eq, sql } from 'drizzle-orm';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { broadcastDownloadUpdate } from './download-broadcast';
import type { ReservedPartialDownloadFile } from './download-file-path';
import {
    completeDownloadFromPartial,
    getCompletedPartialProgress,
    handleDownloadFailure,
    removePartialFile,
} from './download-finalize';
import { transferWithReconnects } from './download-reconnect';
import {
    requestDownloadCancellation,
    requestDownloadPause,
    type DownloadTask,
} from './download-task';
import { describeError } from './download-transfer';

export { broadcastDownloadUpdate, setMainWindow } from './download-broadcast';

const downloadQueue: DownloadTask[] = [];
let activeDownload: DownloadTask | null = null;
const settlementWaiters = new Map<number, Array<() => void>>();

export function enqueueDownload(task: DownloadTask): void {
    // A duplicate id (e.g. two rapid Resume clicks racing the status
    // refresh) must not produce two transfers for the same row.
    if (
        activeDownload?.id === task.id ||
        downloadQueue.some((queued) => queued.id === task.id)
    ) {
        return;
    }

    downloadQueue.push(task);
    broadcastDownloadUpdate();
    void processQueue();
}

export async function pauseDownload(downloadId: number): Promise<boolean> {
    if (activeDownload?.id === downloadId) {
        return requestDownloadPause(activeDownload);
    }

    const queueIndex = downloadQueue.findIndex(
        (task) => task.id === downloadId
    );
    if (queueIndex === -1) {
        return false;
    }

    downloadQueue.splice(queueIndex, 1);
    const db = await getDatabase();
    await db
        .update(schema.downloads)
        .set({
            errorMessage: null,
            status: 'paused',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, downloadId));
    broadcastDownloadUpdate();
    return true;
}

export async function cancelDownload(downloadId: number): Promise<boolean> {
    if (activeDownload?.id === downloadId) {
        return requestDownloadCancellation(activeDownload);
    }

    const queueIndex = downloadQueue.findIndex(
        (task) => task.id === downloadId
    );
    if (queueIndex !== -1) {
        const [queuedTask] = downloadQueue.splice(queueIndex, 1);
        const db = await getDatabase();
        const removed = queuedTask?.catchup
            ? await cleanupStoredCatchupPartial(
                  db,
                  downloadId,
                  queuedTask.filePath,
                  true
              )
            : removePartialFile(queuedTask?.filePath);
        await persistQueuedCancellation(
            db,
            downloadId,
            removed ? null : (queuedTask?.filePath ?? null)
        );
        broadcastDownloadUpdate();
        return true;
    }

    const db = await getDatabase();
    const rows = await db
        .select({
            filePath: schema.downloads.filePath,
            contentType: schema.downloads.contentType,
            status: schema.downloads.status,
        })
        .from(schema.downloads)
        .where(eq(schema.downloads.id, downloadId))
        .limit(1);
    const item = rows[0];
    if (item?.status !== 'paused') {
        return false;
    }

    const removed =
        item.contentType === 'catchup'
            ? await cleanupStoredCatchupPartial(
                  db,
                  downloadId,
                  item.filePath,
                  true
              )
            : removePartialFile(item.filePath);
    await persistQueuedCancellation(
        db,
        downloadId,
        removed ? null : item.filePath
    );
    broadcastDownloadUpdate();
    return true;
}

/** Keep the journal row until an accepted active cancellation has settled. */
export async function prepareArchiveRemoval(
    downloadId: number
): Promise<boolean> {
    if (activeDownload?.id === downloadId && activeDownload.catchup) {
        if (!requestDownloadCancellation(activeDownload)) return false;
        await new Promise<void>((resolve) => {
            const waiters = settlementWaiters.get(downloadId) ?? [];
            waiters.push(resolve);
            settlementWaiters.set(downloadId, waiters);
        });
    } else if (
        downloadQueue.some((task) => task.id === downloadId && task.catchup)
    ) {
        await cancelDownload(downloadId);
    }
    return true;
}

export function hasRuntimeDownload(downloadId: number): boolean {
    return (
        activeDownload?.id === downloadId ||
        downloadQueue.some((task) => task.id === downloadId)
    );
}

export function isDownloadCommitting(downloadId: number): boolean {
    return (
        activeDownload?.id === downloadId &&
        !!activeDownload.catchupCommitStarted
    );
}

export function removeDownloadFromRuntime(downloadId: number): boolean {
    if (activeDownload?.id === downloadId) {
        if (!requestDownloadCancellation(activeDownload)) return false;
    }

    const queueIndex = downloadQueue.findIndex(
        (task) => task.id === downloadId
    );
    if (queueIndex !== -1) {
        downloadQueue.splice(queueIndex, 1);
    }
    return true;
}

async function processQueue(): Promise<void> {
    if (activeDownload || downloadQueue.length === 0) {
        return;
    }

    const task = downloadQueue.shift();
    if (!task) {
        return;
    }

    activeDownload = task;
    try {
        await startDownload(task);
    } catch (error) {
        console.error(
            `[Downloads] Unhandled error for ${task.fileName}:`,
            describeError(error)
        );
        finishTask(task);
    }
}

function finishTask(task: DownloadTask): void {
    if (activeDownload === task) {
        activeDownload = null;
    }
    for (const resolve of settlementWaiters.get(task.id) ?? []) resolve();
    settlementWaiters.delete(task.id);
    broadcastDownloadUpdate();
    void processQueue();
}

async function startDownload(task: DownloadTask): Promise<void> {
    const db = await getDatabase();
    await db
        .update(schema.downloads)
        .set({
            errorMessage: null,
            status: 'downloading',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
    broadcastDownloadUpdate();

    let reservation: ReservedPartialDownloadFile | undefined;
    try {
        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        if (task.catchup) {
            if (task.filePath) {
                const proof = (
                    await readArchiveFinalizations(db, [task.id])
                ).get(task.id);
                cleanupArchiveCapture(proof);
                task.catchupExpectedPartialIdentity = proof?.partialIdentity;
                // No durable ownership evidence: preserve the old entry and
                // reserve a fresh destination instead of adopting it.
                if (!proof) task.filePath = null;
            }
            if (!task.filePath) {
                // A fresh reservation must not inherit a previous attempt's proof.
                await clearArchiveFinalization(db, task.id);
            }
        }
        reservation = await reserveTarget(db, task);
        task.fileName = reservation.filename;
        task.filePath = reservation.path;
        await db
            .update(schema.downloads)
            .set({
                errorMessage: null,
                fileName: reservation.filename,
                filePath: reservation.path,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, task.id));

        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        const completedPartialProgress = getCompletedPartialProgress(task);
        if (completedPartialProgress) {
            await completeDownloadFromPartial(
                db,
                task,
                reservation,
                completedPartialProgress
            );
            return;
        }

        const progress = await (task.catchup
            ? transferCatchupToPartialFile(db, task, reservation)
            : transferWithReconnects(db, task, reservation));
        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        await completeDownloadFromPartial(db, task, reservation, progress);
    } catch (error) {
        if (task.cancelRequested) {
            await persistCancellation(db, task);
            return;
        }
        if (task.pauseRequested) {
            await persistPause(db, task);
            return;
        }

        await handleDownloadFailure(db, task, reservation, error);
    } finally {
        task.abortController = undefined;
        finishTask(task);
    }
}
