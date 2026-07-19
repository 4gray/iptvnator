import { eq, sql } from 'drizzle-orm';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as schema from '../../database/schema';
import { requestWithValidatedRedirects } from '../../util/validated-axios';
import { broadcastDownloadUpdate } from './download-broadcast';
import {
    getPartialDownloadSize,
    type ReservedPartialDownloadFile,
} from './download-file-path';
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

export async function transferToPartialFile(
    db: DownloadsDatabase,
    task: DownloadTask,
    reservation: ReservedPartialDownloadFile
): Promise<TransferProgress> {
    const resumeOffset = getResumeOffset(task, reservation);

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
    try {
        effectiveOffset = validateResumeResponse(
            reservation,
            response.status,
            response.headers,
            resumeOffset
        );
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

    let bytesDownloaded = effectiveOffset;
    let lastProgressUpdate = 0;
    const progressThrottleMs = 500;
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
        await pipeline(readable, output);
    } finally {
        abortController.signal.removeEventListener('abort', abortStream);
    }

    await persistProgress(db, task, { bytesDownloaded, totalBytes });
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

function validateResumeResponse(
    reservation: ReservedPartialDownloadFile,
    status: number,
    headers: unknown,
    resumeOffset: number
): number {
    if (resumeOffset === 0) {
        return 0;
    }

    if (status !== 206) {
        // Either the server ignored Range or If-Range detected that the
        // remote entity changed. The retained partial is unusable either way,
        // so restart from byte zero instead of failing the download.
        console.warn(
            `[Downloads] Restarting ${reservation.filename} from the beginning (resume request answered with HTTP ${status})`
        );
        return 0;
    }

    const contentRange = getHeaderValue(
        headers as Record<string, unknown>,
        'content-range'
    );
    const start = contentRange?.match(/^bytes\s+(\d+)-/i)?.[1];
    if (start === undefined || Number(start) !== resumeOffset) {
        throw new Error('Server returned an invalid resume range');
    }
    return resumeOffset;
}

function getResponseValidator(headers: unknown): string | null {
    const headerMap = headers as Record<string, unknown>;
    const etag = getHeaderValue(headerMap, 'etag');
    // If-Range only accepts strong validators, so skip weak W/ ETags.
    if (etag && !etag.startsWith('W/')) {
        return etag;
    }
    return getHeaderValue(headerMap, 'last-modified') ?? null;
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

function getTotalBytes(headers: unknown, resumeOffset: number): number | null {
    const headerMap = headers as Record<string, unknown>;
    const contentRange = getHeaderValue(headerMap, 'content-range');
    if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
            return Number(match[1]);
        }
    }

    const contentLength = getHeaderValue(headerMap, 'content-length');
    if (!contentLength) {
        return null;
    }

    const parsed = Number(contentLength);
    return Number.isFinite(parsed) ? resumeOffset + parsed : null;
}

function getHeaderValue(
    headers: Record<string, unknown>,
    name: string
): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(value)) {
        return value.length > 0 ? String(value[0]) : undefined;
    }
    return value === undefined ? undefined : String(value);
}
