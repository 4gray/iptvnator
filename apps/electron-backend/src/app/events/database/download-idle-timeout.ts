import type { Readable } from 'node:stream';

export const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

/** Axios's request timeout stops protecting a stream after response headers. */
export function watchDownloadInactivity(
    readable: Readable,
    timeoutMs: number
): () => void {
    const timer = setTimeout(() => {
        readable.destroy(
            Object.assign(
                new Error('Download response timed out due to inactivity'),
                {
                    code: 'ETIMEDOUT',
                }
            )
        );
    }, timeoutMs);
    timer.unref();
    const reset = () => timer.refresh();
    const stop = () => {
        clearTimeout(timer);
        readable.removeListener('data', reset);
        readable.removeListener('end', stop);
        readable.removeListener('close', stop);
    };
    readable.on('data', reset);
    readable.once('end', stop);
    readable.once('close', stop);
    return stop;
}
