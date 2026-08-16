import { setTimeout as sleep } from 'node:timers/promises';
import type { ReservedPartialDownloadFile } from './download-file-path';
import type {
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';
import {
    describeError,
    InterruptedTransferError,
    toRetainedInterruption,
    transferToPartialFile,
    TruncatedTransferError,
} from './download-transfer';

/**
 * An attempt must end at least this far past the previous attempt to reset
 * the stall budget. Bounds the loop structurally: a server trickling less
 * per connection cannot keep reconnects alive forever.
 */
const RECONNECT_PROGRESS_MIN_BYTES = 65_536;
/** Consecutive attempts without that progress before the failure surfaces. */
const MAX_STALLED_RECONNECTS = 3;
/**
 * Restarts the transfer layer reports via `task.transferRestarts` (overlap
 * mismatch, shrunk entity, 416, ignored Range) each open a fresh progress
 * epoch: clean stall budget and no baseline, because the rebuilt file must be
 * judged on its own progress. Only this many restarts are tolerated per
 * transfer, or an always-restarting server would reset the budget forever.
 */
const MAX_TOLERATED_RESTARTS = 2;
const RECONNECT_DELAY_MS = 1000;

export interface ReconnectDeps {
    delayMs?: number;
    transfer?: typeof transferToPartialFile;
}

/**
 * Runs the transfer, transparently reconnecting when a recoverable network
 * interruption (or clean short response) left a resumable partial behind.
 * Servers that cap each connection at N bytes or seconds — common Xtream
 * anti-download throttling — otherwise force the user to click Retry a dozen
 * times per movie. Reconnects continue as long as attempts make real
 * progress; the stall budget surfaces the last interruption once they stop.
 */
export async function transferWithReconnects(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile,
    deps: ReconnectDeps = {}
): Promise<TransferProgress> {
    const { delayMs = RECONNECT_DELAY_MS, transfer = transferToPartialFile } =
        deps;
    // The first interruption of each epoch always earns a reconnect (there is
    // no attempt of the same file to measure against); afterwards progress is
    // measured against the previous attempt. Epochs open on the transfer
    // layer's explicit restart signal, never on byte inference: a rebuild
    // that lands near the previous attempt's count is indistinguishable from
    // a stall by bytes alone.
    let lastBytes: number | null = null;
    let stalledAttempts = 0;
    let restartCredits = MAX_TOLERATED_RESTARTS;
    let seenRestarts = task.transferRestarts ?? 0;

    for (;;) {
        try {
            return await transfer(db, task, reservation);
        } catch (error) {
            if (task.cancelRequested || task.pauseRequested) {
                throw error;
            }
            const interruption = classifyReconnectableError(
                error,
                reservation,
                task.totalBytes
            );
            if (!interruption) {
                throw error;
            }

            if ((task.transferRestarts ?? 0) > seenRestarts) {
                seenRestarts = task.transferRestarts ?? 0;
                if (restartCredits <= 0) {
                    throw interruption;
                }
                restartCredits -= 1;
                stalledAttempts = 0;
                lastBytes = null;
            }
            const attemptBytes = interruption.progress.bytesDownloaded;
            const advanced =
                lastBytes === null ||
                attemptBytes - lastBytes >= RECONNECT_PROGRESS_MIN_BYTES;
            stalledAttempts = advanced ? 0 : stalledAttempts + 1;
            if (stalledAttempts >= MAX_STALLED_RECONNECTS) {
                throw interruption;
            }
            lastBytes = attemptBytes;

            console.warn(
                `[Downloads] ${describeError(interruption)}; reconnecting ${task.fileName} at ${attemptBytes} bytes`
            );
            await sleep(delayMs);
            if (task.cancelRequested || task.pauseRequested) {
                throw interruption;
            }
        }
    }
}

function classifyReconnectableError(
    error: unknown,
    reservation: ReservedPartialDownloadFile,
    totalBytes: number | null | undefined
): InterruptedTransferError | TruncatedTransferError | null {
    if (
        error instanceof InterruptedTransferError ||
        error instanceof TruncatedTransferError
    ) {
        return error;
    }
    return toRetainedInterruption(error, reservation, totalBytes);
}
