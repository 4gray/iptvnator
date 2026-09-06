import type { Request, Response } from 'express';

export interface SlowSeriesDownloadOptions {
    readonly chunkSize: number;
    readonly intervalMs: number;
    readonly totalBytes: number;
}

export const DEFAULT_SLOW_SERIES_DOWNLOAD_OPTIONS: SlowSeriesDownloadOptions = {
    chunkSize: 32 * 1024,
    intervalMs: 100,
    totalBytes: 8 * 1024 * 1024,
};

/**
 * `local-media` fixture: a movie finishes in well under a second so the
 * library shows a completed card, while an episode trickles for ~20 s so the
 * queue still shows a live progress row when the screenshot is taken.
 */
export const LOCAL_MEDIA_MOVIE_DOWNLOAD_OPTIONS: SlowSeriesDownloadOptions = {
    chunkSize: 2 * 1024 * 1024,
    intervalMs: 2,
    totalBytes: 96 * 1024 * 1024,
};

export const LOCAL_MEDIA_EPISODE_DOWNLOAD_OPTIONS: SlowSeriesDownloadOptions = {
    chunkSize: 256 * 1024,
    intervalMs: 100,
    totalBytes: 48 * 1024 * 1024,
};

export function streamSlowSeriesDownload(
    request: Request,
    response: Response,
    options: SlowSeriesDownloadOptions = DEFAULT_SLOW_SERIES_DOWNLOAD_OPTIONS
): void {
    validateOptions(options);
    const chunkBuffer = Buffer.alloc(options.chunkSize);
    let sentBytes = 0;
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    function stop(): void {
        if (stopped) return;
        stopped = true;
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        request.off('close', stop);
        response.off('close', stop);
        response.off('finish', stop);
        response.off('drain', scheduleChunk);
    }

    function scheduleChunk(): void {
        if (!stopped && !timer) {
            timer = setTimeout(writeChunk, options.intervalMs);
        }
    }

    function writeChunk(): void {
        timer = undefined;
        if (stopped || response.destroyed || response.writableEnded) {
            stop();
            return;
        }

        const remainingBytes = options.totalBytes - sentBytes;
        const chunk =
            remainingBytes >= chunkBuffer.length
                ? chunkBuffer
                : chunkBuffer.subarray(0, remainingBytes);
        sentBytes += chunk.length;
        const canContinue = response.write(chunk);

        if (sentBytes >= options.totalBytes) {
            response.end();
        } else if (canContinue) {
            scheduleChunk();
        } else {
            response.once('drain', scheduleChunk);
        }
    }

    request.once('close', stop);
    response.once('close', stop);
    response.once('finish', stop);
    response
        .status(200)
        .type('video/mp4')
        .set('Content-Length', String(options.totalBytes))
        .set('Cache-Control', 'no-store')
        .flushHeaders();
    scheduleChunk();
}

function validateOptions(options: SlowSeriesDownloadOptions): void {
    if (!Number.isSafeInteger(options.totalBytes) || options.totalBytes <= 0) {
        throw new Error('Slow download totalBytes must be a positive integer.');
    }
    if (!Number.isSafeInteger(options.chunkSize) || options.chunkSize <= 0) {
        throw new Error('Slow download chunkSize must be a positive integer.');
    }
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 0) {
        throw new Error(
            'Slow download intervalMs must be a non-negative integer.'
        );
    }
}
