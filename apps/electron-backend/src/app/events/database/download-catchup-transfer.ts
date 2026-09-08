import { recordArchivePartial } from './download-catchup-journal';
import {
    assertArchiveCopyHeadroom,
    createArchiveByteGuard,
    getArchiveByteLimit,
} from './download-catchup-limits';
import { openCatchupOutput } from './download-catchup-output';
import { Readable, Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { requestWithValidatedRedirects } from '../../util/validated-axios';
import { validateCatchupDownload } from './download-catchup';
import type { ReservedPartialDownloadFile } from './download-file-path';
import type {
    DownloadsDatabase,
    DownloadTask,
    TransferProgress,
} from './download-task';
import {
    persistProgress,
    persistTransferStart,
} from './download-transfer-persistence';

/** Check every 188-byte MPEG-TS packet without retaining the media in memory. */
export function createTsValidator(): Transform {
    let bytes = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            for (
                let offset = (188 - (bytes % 188)) % 188;
                offset < chunk.length;
                offset += 188
            ) {
                if (chunk[offset] !== 0x47) {
                    callback(
                        new Error(
                            'The provider did not return a valid TS archive'
                        )
                    );
                    return;
                }
            }
            bytes += chunk.length;
            callback(null, chunk);
        },
        flush(callback) {
            callback(
                bytes < 188 * 3 || bytes % 188 !== 0
                    ? new Error('The archive stream is empty or incomplete')
                    : undefined
            );
        },
    });
}

export async function transferCatchupToPartialFile(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile
): Promise<TransferProgress> {
    const metadata = validateCatchupDownload(task.catchup, task.url);
    const controller = new AbortController();
    task.abortController = controller;
    if (task.cancelRequested || task.pauseRequested) controller.abort();
    // An archive endpoint must terminate. Bound both stalled and endless streams.
    const timeoutMs = Math.min(
        24 * 3600_000,
        (metadata.stopTimestamp - metadata.startTimestamp) * 2000 + 600_000
    );
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let readable: Readable | undefined;
    let output: Awaited<ReturnType<typeof openCatchupOutput>> | undefined;
    let pendingProgress = Promise.resolve();
    try {
        const response = await requestWithValidatedRedirects<Readable>(
            task.url,
            {
                headers: { ...task.headers, 'Accept-Encoding': 'identity' },
                method: 'GET',
                responseType: 'stream',
                decompress: false,
                signal: controller.signal,
                timeout: 30_000,
                validateStatus: (status) => status === 200,
            },
            { allowPrivateNetworks: true }
        );
        readable = response.data;
        readable.on('error', () => undefined);
        const contentType = String(response.headers['content-type'] ?? '');
        if (
            /mpegurl|html|json|xml|text\/plain/i.test(contentType) ||
            (response.headers['content-encoding'] &&
                response.headers['content-encoding'] !== 'identity')
        ) {
            throw new Error('The provider did not return a TS archive');
        }
        const length = Number(response.headers['content-length']);
        const totalBytes =
            Number.isSafeInteger(length) && length > 0 ? length : null;
        // Restart safely before measuring space: the retained file is
        // reclaimable only after its verified descriptor has been truncated.
        output = await openCatchupOutput(
            reservation.partialPath,
            task.catchupExpectedPartialIdentity,
            (identity) =>
                recordArchivePartial(db, task.id, reservation.path, identity)
        );
        output.stream.on('error', () => undefined);
        task.catchupPartialIdentity = output.identity;
        const byteLimit = await getArchiveByteLimit(
            task.directory,
            metadata.stopTimestamp - metadata.startTimestamp,
            totalBytes
        );
        task.totalBytes = totalBytes;
        task.resumeValidator = null;
        await persistTransferStart(db, task, 0, totalBytes);
        let bytesDownloaded = 0;
        let lastProgress = Date.now();
        const progress = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                bytesDownloaded += chunk.length;
                if (Date.now() - lastProgress >= 500) {
                    lastProgress = Date.now();
                    const snapshot = { bytesDownloaded, totalBytes };
                    pendingProgress = pendingProgress.then(() =>
                        persistProgress(db, task, snapshot)
                    );
                    // Apply backpressure while persisting, so no updates outlive finalization.
                    pendingProgress.then(
                        () => callback(null, chunk),
                        (error: Error) => callback(error)
                    );
                } else callback(null, chunk);
            },
        });
        await pipeline(
            readable,
            createArchiveByteGuard(task.directory, byteLimit),
            createTsValidator(),
            progress,
            output.stream,
            { signal: controller.signal }
        );
        if (totalBytes !== null && bytesDownloaded !== totalBytes) {
            throw new Error('The archive stream ended before it was complete');
        }
        await assertArchiveCopyHeadroom(task.directory, bytesDownloaded);
        return { bytesDownloaded, totalBytes: totalBytes ?? bytesDownloaded };
    } catch {
        // Network errors can embed credential-bearing request URLs.
        throw new Error(
            'Archive download failed: the stream was interrupted, expired, exceeded the size or free-space limit, or is not a complete TS response. Retry starts from the beginning.'
        );
    } finally {
        clearTimeout(timer);
        readable?.on('error', () => undefined);
        readable?.destroy();
        if (output) {
            const closed = finished(output.stream).catch(() => undefined);
            output.stream.destroy();
            await closed;
        }
        await pendingProgress.catch(() => undefined);
    }
}
