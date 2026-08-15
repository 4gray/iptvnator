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
    getIndeterminateRangeEnd,
    getResponseValidator,
    getTotalBytes,
    validateResumeResponse,
} from './download-resume-validation';
import type {
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';

import {
    describeError,
    getInterruptedTransferProgress,
    getNetworkErrorCode,
    InterruptedTransferError,
    isRangeNotSatisfiable,
    isRetainableNetworkCode,
    toRetainedInterruption,
    TruncatedTransferError,
} from './download-transfer-errors';

export {
    describeError,
    InterruptedTransferError,
    toRetainedInterruption,
    TruncatedTransferError,
} from './download-transfer-errors';

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
    const restartFromScratch = async (
        reason: string
    ): Promise<TransferProgress> => {
        console.warn(
            `[Downloads] Restarting ${reservation.filename} from the beginning (${reason})`
        );
        task.transferRestarts = (task.transferRestarts ?? 0) + 1;
        await truncate(reservation.partialPath, 0);
        return transferToPartialFile(db, task, reservation, false);
    };

    console.log(`[Downloads] Started: ${reservation.filename}`);
    let response: Awaited<
        ReturnType<typeof requestWithValidatedRedirects<Readable>>
    >;
    try {
        response = await requestWithValidatedRedirects<Readable>(
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
    } catch (error) {
        if (
            resumeOffset > 0 &&
            allowOverlapResume &&
            isRangeNotSatisfiable(error)
        ) {
            // The remote entity shrank below the resume offset: a
            // representation change, not a transport failure. Restart against
            // the current entity instead of deleting the partial as a
            // generic failure.
            return restartFromScratch(
                'the resume range is beyond the server content'
            );
        }
        throw error;
    }

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

    const appendsToRetained = effectiveOffset > 0 || verifyOverlap;
    if (!appendsToRetained && retainedOffset > 0) {
        // The response rewrites the file from byte zero (a 200 answer to a
        // Range request): report the restart so the reconnect loop opens a
        // fresh progress epoch for the rebuilt file.
        task.transferRestarts = (task.transferRestarts ?? 0) + 1;
    }
    // Total handling separates authority from information. The response's own
    // total is authoritative. A total carried from an earlier response is
    // informational only — it keeps a mid-stream reset over a total-less
    // reconnect classifiable as a retained interruption instead of generic
    // partial-deleting cleanup — and is dropped once the bytes on disk
    // falsify it. A fresh or restarted transfer carries nothing forward.
    const responseTotal = getTotalBytes(response.headers, effectiveOffset);
    const carriedTotal =
        appendsToRetained &&
        task.totalBytes != null &&
        retainedOffset < task.totalBytes
            ? task.totalBytes
            : null;
    const totalBytes = responseTotal ?? carriedTotal;
    // Completion decisions use only what THIS response proves: its own total,
    // or the end of its advertised indeterminate range. A carried total can
    // flag a short transfer but never authorize finalization.
    const completionBoundary =
        responseTotal ??
        getIndeterminateRangeEnd(response.headers) ??
        carriedTotal;
    if (response.status === 206) {
        // Proven range capability outlives this attempt: a later request-
        // phase failure may retain the partial on this evidence alone.
        task.serverAcceptsRanges = true;
    }
    if (effectiveOffset === 0 && !verifyOverlap) {
        // Fresh or restarted transfer: every byte on disk will come from this
        // response, so its validator describes the file. A verify-append
        // attempt must NOT promote the validator yet — until the verifier
        // consumes the complete overlap, nothing proves the retained bytes
        // belong to this entity, and a promoted validator would let the next
        // resume If-Range-append onto an unverified prefix.
        task.resumeValidator = getResponseValidator(response.headers);
    }
    const overlapVerifier = expectedOverlap
        ? createOverlapVerifier(expectedOverlap)
        : null;
    // Like the validator, the response's total stays uncommitted (task and
    // row) until the complete overlap has matched: a persisted total equal to
    // the unverified partial's size would let the completed-partial shortcut
    // finalize unproven bytes after a pause, crash, or retained failure.
    const provenTotal = () =>
        overlapVerifier && !overlapVerifier.isComplete()
            ? carriedTotal
            : totalBytes;
    task.totalBytes = provenTotal();
    // Reported progress never drops below what the .part already holds: the
    // overlap replay re-counts from the rewound offset while the file keeps
    // all of its retained bytes.
    const progressFloor = appendsToRetained ? retainedOffset : 0;
    await persistTransferStart(
        db,
        task,
        Math.max(effectiveOffset, progressFloor),
        provenTotal()
    );

    // Counts response bytes from the request offset, so with an overlap the
    // tally converges on the partial's retained size as the overlap replays
    // and only then grows past it.
    let bytesDownloaded = effectiveOffset;
    let lastProgressUpdate = 0;
    const progressThrottleMs = 500;
    const output = createWriteStream(reservation.partialPath, {
        flags: appendsToRetained ? 'a' : 'w',
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
            bytesDownloaded: Math.max(bytesDownloaded, progressFloor),
            totalBytes: provenTotal(),
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
            return restartFromScratch(
                'retained partial does not match the server content'
            );
        }
        if (isRetainableNetworkCode(getNetworkErrorCode(error))) {
            const fileBytes = getPartialDownloadSize(reservation.path);
            const overlapProven =
                !overlapVerifier || overlapVerifier.isComplete();
            const provenExpectation = provenTotal();
            if (
                overlapProven &&
                completionBoundary !== null &&
                fileBytes === completionBoundary &&
                (provenExpectation === null || fileBytes === provenExpectation)
            ) {
                // The connection reset AFTER the final byte: every byte the
                // response's own evidence demands is on disk and the overlap
                // is proven. Treating this as an interruption would resume at
                // EOF, collect a 416, and truncate a complete file — so it is
                // a completion, not a failure.
                return {
                    bytesDownloaded: fileBytes,
                    totalBytes: provenTotal(),
                };
            }
        }
        const interruptedProgress = getInterruptedTransferProgress(
            error,
            reservation,
            effectiveOffset,
            provenTotal(),
            // A 206 proves the server serves ranges: the partial stays
            // resumable even when a stale informational total is falsified
            // by the bytes on disk.
            response.status === 206
        );
        if (interruptedProgress) {
            // Keep the live task consistent with what is persisted: the next
            // automatic reconnect reuses it, and a stale falsified total
            // would make getResumeOffset reject the retained partial.
            task.totalBytes = interruptedProgress.progress.totalBytes;
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
            completionBoundary !== null &&
            bytesDownloaded >= completionBoundary
        ) {
            // The server delivered its complete (now shorter) entity without
            // ever covering the window — the remote representation shrank,
            // so the retained partial belongs to a different entity.
            return restartFromScratch(
                'retained partial does not match the server content'
            );
        }
        // The stream died early: an ordinary retained interruption. The
        // response's total stays uncommitted — the overlap never matched.
        await persistProgress(db, task, {
            bytesDownloaded: reportedBytes,
            totalBytes: provenTotal(),
        });
        throw new TruncatedTransferError({
            bytesDownloaded: reportedBytes,
            totalBytes: provenTotal(),
        });
    }
    if (verifyOverlap) {
        // The complete overlap matched: the partial is proven to belong to
        // this entity, so its validator and total may now cover the file.
        task.resumeValidator = getResponseValidator(response.headers);
        task.totalBytes = totalBytes;
    }
    await persistProgress(db, task, {
        bytesDownloaded: reportedBytes,
        totalBytes,
    });
    if (completionBoundary !== null && bytesDownloaded < completionBoundary) {
        throw new TruncatedTransferError({
            bytesDownloaded: reportedBytes,
            totalBytes,
        });
    }
    return { bytesDownloaded, totalBytes };
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
