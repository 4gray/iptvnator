import { createWriteStream } from 'node:fs';
import { truncate } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requestWithValidatedRedirects } from '../../util/validated-axios';
import {
    getPartialDownloadSize,
    type ReservedPartialDownloadFile,
} from './download-file-path';
import {
    persistProgress,
    persistTransferStart,
} from './download-transfer-persistence';
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
    getUnsatisfiedRangeTotal,
    validateResumeResponse,
} from './download-resume-validation';
import type {
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';

import {
    classifyRangeNotSatisfiable,
    getInterruptedTransferProgress,
    getNetworkErrorCode,
    InterruptedTransferError,
    isRangeNotSatisfiable,
    isRetainableNetworkCode,
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
    const probingEof = task.probeEof === true && retainedOffset > 0;
    task.probeEof = undefined;
    if (probingEof && !task.resumeValidator && allowOverlapResume) {
        // The previous attempt verified the complete overlap and appended
        // nothing against an indeterminate range — the partial may BE the
        // complete unknown-length entity. Ask for the next byte outright: a
        // compliant 416 with `bytes */N` then confirms completion, which the
        // rewound request could never observe.
        resumeOffset = retainedOffset;
    } else if (
        retainedOffset > 0 &&
        !task.resumeValidator &&
        allowOverlapResume
    ) {
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

    // Byte-exact transfer: Range offsets, totals, and the persisted .part
    // must describe the SAME representation, and axios transparently decodes
    // gzip/brotli — so content codings are refused outright.
    const headers: Record<string, string> = {
        ...(task.headers ?? {}),
        'Accept-Encoding': 'identity',
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
            const confirmedTotal = getUnsatisfiedRangeTotal(
                (error as { response?: { headers?: unknown } }).response
                    ?.headers
            );
            const action = classifyRangeNotSatisfiable({
                confirmedTotal,
                identityProven: probingEof || task.resumeValidator != null,
                resumeOffset,
                retainedOffset,
            });
            if (action === 'complete') {
                return {
                    bytesDownloaded: retainedOffset,
                    totalBytes: confirmedTotal,
                };
            }
            if (action === 'retain') {
                task.totalBytes = null;
                throw new TruncatedTransferError({
                    bytesDownloaded: retainedOffset,
                    totalBytes: null,
                });
            }
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

    if (probingEof && effectiveOffset === resumeOffset) {
        // The EOF probe found MORE bytes at the offset the previous verified
        // replay treated as the end. They cannot be appended without a fresh
        // overlap proof, so retire this response and let the next attempt
        // resume through the ordinary rewound verification.
        readable.on('error', () => undefined);
        readable.destroy();
        const probeTotal = getTotalBytes(response.headers, effectiveOffset);
        task.totalBytes = probeTotal;
        throw new TruncatedTransferError({
            bytesDownloaded: retainedOffset,
            totalBytes: probeTotal,
        });
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
    const indeterminateEnd = getIndeterminateRangeEnd(response.headers);
    // A carried total is dropped the moment ANY evidence contradicts it: the
    // bytes already on disk reaching it, or this response's advertised range
    // extending past it — waiting for the bytes to arrive would leave a
    // pause/exit window in which an N/N row lets the completed-partial
    // shortcut finalize a truncated file.
    const carriedTotal =
        appendsToRetained &&
        task.totalBytes != null &&
        retainedOffset < task.totalBytes &&
        // STRICTLY below: an indeterminate range that can even REACH the
        // carried total could leave an N/N row (mid-stream pause included)
        // for the completed-partial shortcut, though `/*` withheld the total.
        (indeterminateEnd === null || indeterminateEnd < task.totalBytes)
            ? task.totalBytes
            : null;
    const totalBytes = responseTotal ?? carriedTotal;
    // Completion decisions use only what THIS response proves: its own total,
    // or the end of its advertised indeterminate range. A carried total can
    // flag a short transfer but never authorize finalization.
    const completionBoundary =
        responseTotal ?? indeterminateEnd ?? carriedTotal;
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
        if (verifyOverlap && overlapVerifier?.isComplete()) {
            // The overlap fully matched before the failure: the proof holds
            // regardless of how the stream ended, so promote the validator
            // AND the response total now — otherwise a reconnect would replay
            // the window for sub-threshold progress, and a pause landing
            // while the partial sits at a stale carried total would persist
            // an N/N row for the completed-partial shortcut to finalize.
            task.resumeValidator = getResponseValidator(response.headers);
            task.totalBytes = totalBytes;
            if (
                !task.resumeValidator &&
                bytesDownloaded === retainedOffset &&
                responseTotal === null &&
                indeterminateEnd !== null
            ) {
                // Verified zero-growth replay of an indeterminate range that
                // ended in a reset: same as the clean-EOF case, the partial
                // may BE the complete entity — arm the EOF probe instead of
                // replaying the same tail until the stall budget expires.
                task.probeEof = true;
            }
        }
        if (isRetainableNetworkCode(getNetworkErrorCode(error))) {
            const fileBytes = getPartialDownloadSize(reservation.path);
            const overlapProven =
                !overlapVerifier || overlapVerifier.isComplete();
            if (
                !overlapProven &&
                allowOverlapResume &&
                responseTotal !== null &&
                bytesDownloaded >= responseTotal
            ) {
                // The reset arrived only after the response delivered its
                // complete AUTHORITATIVE total, all inside the verification
                // window: the entity is provably shorter than the partial —
                // the same shrink the clean-EOF path restarts on, just with a
                // reset ending instead of a close.
                return restartFromScratch(
                    'retained partial does not match the server content'
                );
            }
            if (
                overlapProven &&
                responseTotal !== null &&
                fileBytes === responseTotal &&
                fileBytes === (provenTotal() ?? responseTotal)
            ) {
                // The connection reset AFTER the final byte: every byte of
                // the response's AUTHORITATIVE total is on disk and the
                // overlap is proven. Treating this as an interruption would
                // resume at EOF, collect a 416, and truncate a complete file
                // — so it is a completion, not a failure. An indeterminate
                // range end never qualifies: reaching Y of `bytes X-Y/*`
                // proves the range was delivered, not that the entity ends
                // there, so those resets stay retained interruptions.
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
            provenTotal()
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
            responseTotal !== null &&
            bytesDownloaded >= responseTotal
        ) {
            // The server delivered its complete (now shorter) entity without
            // ever covering the window — the remote representation shrank,
            // so the retained partial belongs to a different entity. Only an
            // AUTHORITATIVE total proves that; an indeterminate range end
            // stays a retained interruption below.
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
    const indeterminateRange =
        responseTotal === null && indeterminateEnd !== null;
    // A clean delivery can outgrow a stale carried total; keep the persisted
    // AND in-memory totals consistent with the bytes on disk, or the next
    // reconnect's resume-offset guard would reject the retained partial into
    // generic cleanup.
    const settledTotal =
        totalBytes !== null && reportedBytes > totalBytes ? null : totalBytes;
    task.totalBytes = settledTotal;
    await persistProgress(db, task, {
        bytesDownloaded: reportedBytes,
        totalBytes: settledTotal,
    });
    if (
        (completionBoundary !== null && bytesDownloaded < completionBoundary) ||
        indeterminateRange
    ) {
        // Short of the response's evidence — or an indeterminate range that
        // ended cleanly: reaching Y of `bytes X-Y/*` proves the range was
        // delivered, never that the entity ends there, so the transfer stays
        // incomplete and reconnects from the new offset. Only a response
        // with no range and no total keeps the clean-EOF completion contract
        // of unknown-length HTTP.
        if (
            indeterminateRange &&
            verifyOverlap &&
            overlapVerifier?.isComplete() &&
            bytesDownloaded === retainedOffset
        ) {
            // A verified replay that appended nothing: the partial may BE the
            // complete entity. Let the next attempt probe EOF directly so a
            // compliant 416 can confirm completion instead of repeating the
            // rewind forever.
            task.probeEof = true;
        }
        throw new TruncatedTransferError({
            bytesDownloaded: reportedBytes,
            totalBytes: settledTotal,
        });
    }
    return { bytesDownloaded, totalBytes: settledTotal };
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
