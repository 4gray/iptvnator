import { eq, sql } from 'drizzle-orm';
import { createWriteStream } from 'node:fs';
import { truncate } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as schema from '../../database/schema';
import { requestWithValidatedRedirects } from '../../util/validated-axios';
import { broadcastDownloadUpdate } from './download-broadcast';
import {
    getPartialDownloadSize,
    type ReservedPartialDownloadFile,
} from './download-file-path';
import {
    createOverlapVerifier,
    OVERLAP_VERIFICATION_BYTES,
    OverlapMismatchError,
    readPartialTail,
} from './download-overlap';
import {
    getResponseValidator,
    getTotalBytes,
    validateResumeResponse,
} from './download-resume-validation';
import type {
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';

/**
 * Log transfer failures by message only: a raw AxiosError dumps its request
 * config, and download URLs can embed portal credentials.
 */
export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The response stream ended cleanly before the advertised representation
 * size was reached (e.g. a proxy that caps each response). The partial is
 * valid — the caller must retain it so a retry can continue via Range.
 */
export class TruncatedTransferError extends Error {
    constructor(readonly progress: TransferProgress) {
        super('Transfer ended before the advertised size');
    }
}

/**
 * Mid-transfer codes plus connection-establishment failures: a reconnect
 * attempt against a rebooting host fails before any response, and deleting
 * a multi-gigabyte partial over that would be data loss, not cleanup.
 */
const RETAINABLE_NETWORK_ERROR_CODES = new Set([
    'EAI_AGAIN',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ETIMEDOUT',
    'ERR_HTTP2_STREAM_CANCEL',
    'ERR_HTTP2_STREAM_ERROR',
    'ERR_STREAM_PREMATURE_CLOSE',
]);

export class InterruptedTransferError extends Error {
    constructor(
        readonly progress: TransferProgress,
        networkCode: string
    ) {
        super(
            `DOWNLOAD_NETWORK_INTERRUPTED (${networkCode}): Retry to continue from the saved partial file`
        );
    }
}

export async function transferToPartialFile(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile,
    allowOverlapResume = true
): Promise<TransferProgress> {
    const retainedOffset = getResumeOffset(task, reservation);
    let resumeOffset = retainedOffset;
    let overlapBytes = 0;
    if (retainedOffset > 0 && !task.resumeValidator) {
        // No validator to hand to If-Range: rewind the request by the overlap
        // window and prove the entity is unchanged by comparing that window
        // against the partial's tail before appending a single byte.
        overlapBytes = allowOverlapResume
            ? Math.min(retainedOffset, OVERLAP_VERIFICATION_BYTES)
            : retainedOffset;
        resumeOffset = retainedOffset - overlapBytes;
        if (resumeOffset === 0) {
            // The whole partial fits inside the overlap window — re-downloading
            // it costs no more than verifying it would.
            overlapBytes = 0;
            console.warn(
                `[Downloads] Restarting ${reservation.filename} from the beginning (saved partial is smaller than the overlap verification window)`
            );
        }
    }

    const headers = {
        ...(task.headers ?? {}),
    };
    if (resumeOffset > 0) {
        headers.Range = `bytes=${resumeOffset}-`;
        if (task.resumeValidator) {
            headers['If-Range'] = task.resumeValidator;
        }
    }

    const abortController = new AbortController();
    task.abortController = abortController;
    if (task.cancelRequested || task.pauseRequested) {
        abortController.abort();
    }

    console.log(`[Downloads] Started: ${reservation.filename}`);
    const response = await requestWithValidatedRedirects<Readable>(
        task.url,
        {
            headers,
            method: 'GET',
            responseType: 'stream',
            signal: abortController.signal,
            validateStatus: (status) => status >= 200 && status < 300,
        },
        { allowPrivateNetworks: true }
    );

    const readable = response.data;
    let effectiveOffset = resumeOffset;
    let expectedOverlap: Buffer | null = null;
    try {
        effectiveOffset = validateResumeResponse(
            reservation,
            response.status,
            response.headers,
            resumeOffset
        );
        if (effectiveOffset > 0 && overlapBytes > 0) {
            expectedOverlap = await readPartialTail(
                reservation.partialPath,
                effectiveOffset,
                overlapBytes
            );
        }
    } catch (error) {
        // Abandon the unconsumed response body; swallow its error events so
        // destroying a stream nobody is piping cannot crash the process.
        readable.on('error', () => undefined);
        readable.destroy();
        throw error;
    }

    const totalBytes = getTotalBytes(response.headers, effectiveOffset);
    task.totalBytes = totalBytes;
    if (effectiveOffset === 0) {
        task.resumeValidator = getResponseValidator(response.headers);
    }
    await persistTransferStart(db, task, effectiveOffset, totalBytes);

    // Counts response bytes from the request offset, so with an overlap the
    // tally passes through the partial's retained size as the overlap replays
    // and only then grows past it — matching the file at every moment.
    let bytesDownloaded = effectiveOffset;
    let lastProgressUpdate = 0;
    const progressThrottleMs = 500;
    const overlapVerifier = expectedOverlap
        ? createOverlapVerifier(expectedOverlap)
        : null;
    const output = createWriteStream(reservation.partialPath, {
        flags: effectiveOffset > 0 ? 'a' : 'w',
    });
    const abortStream = () => {
        readable.destroy(new Error('Download aborted'));
    };

    if (abortController.signal.aborted) {
        abortStream();
    } else {
        abortController.signal.addEventListener('abort', abortStream, {
            once: true,
        });
    }
    readable.on('data', (chunk: Buffer | string) => {
        bytesDownloaded += Buffer.isBuffer(chunk)
            ? chunk.length
            : Buffer.byteLength(chunk);
        const now = Date.now();
        if (now - lastProgressUpdate < progressThrottleMs) {
            return;
        }
        lastProgressUpdate = now;
        void persistProgress(db, task, {
            bytesDownloaded,
            totalBytes,
        }).catch((error) => {
            console.error('[Downloads] Failed to persist progress:', error);
        });
    });

    try {
        await (overlapVerifier
            ? pipeline(readable, overlapVerifier, output)
            : pipeline(readable, output));
    } catch (error) {
        if (error instanceof OverlapMismatchError && allowOverlapResume) {
            // The server is serving a different entity than the partial came
            // from. Nothing was appended; discard the partial and download
            // the current entity from scratch.
            console.warn(
                `[Downloads] Restarting ${reservation.filename} from the beginning (retained partial does not match the server content)`
            );
            await truncate(reservation.partialPath, 0);
            return transferToPartialFile(db, task, reservation, false);
        }
        const interruptedProgress = getInterruptedTransferProgress(
            error,
            reservation,
            effectiveOffset,
            totalBytes
        );
        if (interruptedProgress) {
            await persistProgress(db, task, interruptedProgress.progress);
            throw new InterruptedTransferError(
                interruptedProgress.progress,
                interruptedProgress.networkCode
            );
        }
        throw error;
    } finally {
        abortController.signal.removeEventListener('abort', abortStream);
    }

    await persistProgress(db, task, { bytesDownloaded, totalBytes });
    if (totalBytes !== null && bytesDownloaded < totalBytes) {
        throw new TruncatedTransferError({ bytesDownloaded, totalBytes });
    }
    return { bytesDownloaded, totalBytes };
}

/**
 * Wraps a request-phase failure (no response, e.g. a refused reconnect) into
 * the same retained-partial interruption as a mid-transfer reset, so the
 * bytes already on disk survive the failure. Returns null when the error or
 * the on-disk state does not justify retention.
 */
export function toRetainedInterruption(
    error: unknown,
    reservation: ReservedPartialDownloadFile,
    totalBytes: number | null | undefined
): InterruptedTransferError | null {
    const interrupted = getInterruptedTransferProgress(
        error,
        reservation,
        0,
        totalBytes ?? null
    );
    return interrupted
        ? new InterruptedTransferError(
              interrupted.progress,
              interrupted.networkCode
          )
        : null;
}

function getInterruptedTransferProgress(
    error: unknown,
    reservation: ReservedPartialDownloadFile,
    initialBytes: number,
    totalBytes: number | null
): { networkCode: string; progress: TransferProgress } | null {
    const networkCode =
        error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
    if (
        !RETAINABLE_NETWORK_ERROR_CODES.has(networkCode) ||
        totalBytes === null
    ) {
        return null;
    }

    const bytesDownloaded = getPartialDownloadSize(reservation.path);
    if (
        bytesDownloaded === 0 ||
        bytesDownloaded < initialBytes ||
        bytesDownloaded >= totalBytes
    ) {
        return null;
    }

    return {
        networkCode,
        progress: { bytesDownloaded, totalBytes },
    };
}

function getResumeOffset(
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile
): number {
    const resumeOffset = getPartialDownloadSize(reservation.path);
    if (
        task.totalBytes !== null &&
        task.totalBytes !== undefined &&
        resumeOffset > task.totalBytes
    ) {
        throw new Error('Partial download is larger than expected');
    }
    return resumeOffset;
}

async function persistTransferStart(
    db: DownloadsDatabase,
    task: DownloadTask,
    bytesDownloaded: number,
    totalBytes: number | null
): Promise<void> {
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded,
            resumeValidator: task.resumeValidator ?? null,
            totalBytes,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
    broadcastDownloadUpdate();
}

async function persistProgress(
    db: DownloadsDatabase,
    task: DownloadTask,
    progress: TransferProgress
): Promise<void> {
    await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: progress.bytesDownloaded,
            totalBytes: progress.totalBytes,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, task.id));
    broadcastDownloadUpdate();
}
