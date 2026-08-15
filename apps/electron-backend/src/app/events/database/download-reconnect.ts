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
 * Attempts may legitimately end BELOW the previous attempt when the transfer
 * restarted from byte zero (overlap mismatch truncated the partial, or the
 * server ignored Range). The baseline follows the regression so the rebuilt
 * file's genuine progress is not misread as a stall — but only this many
 * times, or an always-restarting server would reset the budget forever.
 */
const MAX_PROGRESS_REGRESSIONS = 2;
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
    // The first interruption always earns a reconnect (there is no earlier
    // attempt to measure against); afterwards progress is measured against
    // the PREVIOUS attempt, not a high-water mark — a transfer that restarted
    // from byte zero mid-loop must be judged by its rebuilt file, not by the
    // discarded one's size.
    let lastBytes: number | null = null;
    let stalledAttempts = 0;
    let regressionCredits = MAX_PROGRESS_REGRESSIONS;

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

            const attemptBytes = interruption.progress.bytesDownloaded;
            if (lastBytes !== null && attemptBytes < lastBytes) {
                // A restart rewound the file. A tolerated regression is
                // charged to its own bounded budget only — it is neither
                // progress nor a stall, so it must not also consume the
                // stall budget the rebuilt file needs to keep growing.
                if (regressionCredits <= 0) {
                    throw interruption;
                }
                regressionCredits -= 1;
            } else {
                const advanced =
                    lastBytes === null ||
                    attemptBytes - lastBytes >= RECONNECT_PROGRESS_MIN_BYTES;
                stalledAttempts = advanced ? 0 : stalledAttempts + 1;
                if (stalledAttempts >= MAX_STALLED_RECONNECTS) {
                    throw interruption;
                }
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
