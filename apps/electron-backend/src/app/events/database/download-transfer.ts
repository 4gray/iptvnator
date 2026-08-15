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
    if (retainedOffset > 0 && !task.resumeValidator && allowOverlapResume) {
        // No validator to hand to If-Range: rewind the request by the overlap
        // window and prove the entity is unchanged by comparing that window
        // against the partial's tail before appending a single byte. A partial
        // smaller than the window is verified in full from byte zero (plain
        // request, no Range) and appended to — never rewritten in place, so a
        // reconnect that dies early can only grow the file, not shrink it.
        overlapBytes = Math.min(retainedOffset, OVERLAP_VERIFICATION_BYTES);
        resumeOffset = retainedOffset - overlapBytes;
    } else if (retainedOffset > 0 && !task.resumeValidator) {
        // Post-mismatch restart: the truncated .part is rewritten from zero.
        resumeOffset = 0;
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
    let verifyOverlap = false;
    try {
        effectiveOffset = validateResumeResponse(
            reservation,
            response.status,
            response.headers,
            resumeOffset
        );
        // Overlap verification only holds when the response actually starts
        // at the rewound offset; a 200 answer to a Range request restarts
        // from byte zero and rewrites instead.
        verifyOverlap = overlapBytes > 0 && effectiveOffset === resumeOffset;
        if (verifyOverlap) {
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

    // A resumed response that reports no usable total (chunked, or
    // `Content-Range: bytes .../*`) must not erase the total learned earlier:
    // without one, a mid-stream reset could no longer classify as a retained
    // interruption and generic cleanup would delete the verified partial. A
    // fresh or restarted transfer carries nothing forward — its old total
    // described a discarded file.
    const appendsToRetained = effectiveOffset > 0 || verifyOverlap;
    const totalBytes =
        getTotalBytes(response.headers, effectiveOffset) ??
        (appendsToRetained ? (task.totalBytes ?? null) : null);
    task.totalBytes = totalBytes;
    if (effectiveOffset === 0 && !verifyOverlap) {
        // Fresh or restarted transfer: every byte on disk will come from this
        // response, so its validator describes the file. A verify-append
        // attempt must NOT promote the validator yet — until the verifier
        // consumes the complete overlap, nothing proves the retained bytes
        // belong to this entity, and a promoted validator would let the next
        // resume If-Range-append onto an unverified prefix.
        task.resumeValidator = getResponseValidator(response.headers);
    }
    // Reported progress never drops below what the .part already holds: the
    // overlap replay re-counts from the rewound offset while the file keeps
    // all of its retained bytes.
    const progressFloor = appendsToRetained ? retainedOffset : 0;
    await persistTransferStart(
        db,
        task,
        Math.max(effectiveOffset, progressFloor),
        totalBytes
    );

    // Counts response bytes from the request offset, so with an overlap the
    // tally converges on the partial's retained size as the overlap replays
    // and only then grows past it.
    let bytesDownloaded = effectiveOffset;
    let lastProgressUpdate = 0;
    const progressThrottleMs = 500;
    const overlapVerifier = expectedOverlap
        ? createOverlapVerifier(expectedOverlap)
        : null;
    const output = createWriteStream(reservation.partialPath, {
        flags: appendsToRetained ? 'a' : 'w',
    });
    const abortStream = () => {
        readable.destroy(new Error('Download aborted'));
    };
    const restartFromScratch = async (): Promise<TransferProgress> => {
        console.warn(
            `[Downloads] Restarting ${reservation.filename} from the beginning (retained partial does not match the server content)`
        );
        await truncate(reservation.partialPath, 0);
        return transferToPartialFile(db, task, reservation, false);
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
            bytesDownloaded: Math.max(bytesDownloaded, progressFloor),
            totalBytes,
        }).catch((error) => {
            console.error('[Downloads] Failed to persist progress:', error);
        });
    });

    try {
        await (overlapVerifier
            ? pipeline(readable, overlapVerifier.stream, output)
            : pipeline(readable, output));
    } catch (error) {
        if (error instanceof OverlapMismatchError && allowOverlapResume) {
            // The server is serving a different entity than the partial came
            // from. Nothing was appended; discard the partial and download
            // the current entity from scratch.
            return restartFromScratch();
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

    const reportedBytes = Math.max(bytesDownloaded, progressFloor);
    if (overlapVerifier && !overlapVerifier.isComplete()) {
        // The response ended inside the verification window, so nothing was
        // appended and nothing proves the partial matches the entity.
        if (
            allowOverlapResume &&
            totalBytes !== null &&
            bytesDownloaded >= totalBytes
        ) {
            // The server delivered its complete (now shorter) entity without
            // ever covering the window — the remote representation shrank,
            // so the retained partial belongs to a different entity.
            return restartFromScratch();
        }
        // The stream died early: an ordinary retained interruption.
        await persistProgress(db, task, {
            bytesDownloaded: reportedBytes,
            totalBytes,
        });
        throw new TruncatedTransferError({
            bytesDownloaded: reportedBytes,
            totalBytes,
        });
    }
    if (verifyOverlap) {
        // The complete overlap matched: the partial is proven to belong to
        // this entity, so its validator may now cover the whole file.
        task.resumeValidator = getResponseValidator(response.headers);
    }
    await persistProgress(db, task, {
        bytesDownloaded: reportedBytes,
        totalBytes,
    });
    if (totalBytes !== null && bytesDownloaded < totalBytes) {
        throw new TruncatedTransferError({
            bytesDownloaded: reportedBytes,
            totalBytes,
        });
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
