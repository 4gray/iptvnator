import type { Readable } from 'node:stream';

export const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

/** Axios's request timeout stops protecting a stream after response headers. */
export function watchDownloadInactivity(
    readable: Readable,
    timeoutMs: number
): () => void {
    if (readable.destroyed || readable.readableEnded || readable.closed) {
        return () => undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const suspend = () => {
        clearTimeout(timer);
        timer = undefined;
    };
    const reset = () => {
        if (
            stopped ||
            readable.destroyed ||
            readable.readableEnded ||
            readable.isPaused()
        ) {
            return;
        }
        if (timer) {
            timer.refresh();
            return;
        }
        timer = setTimeout(() => {
            readable.destroy(
                Object.assign(
                    new Error('Download response timed out due to inactivity'),
                    { code: 'ETIMEDOUT' }
                )
            );
        }, timeoutMs);
        timer.unref();
    };
    const stop = () => {
        stopped = true;
        suspend();
        readable.removeListener('data', reset);
        readable.removeListener('resume', reset);
        readable.removeListener('pause', suspend);
        readable.removeListener('end', stop);
        readable.removeListener('close', stop);
    };
    readable.on('data', reset);
    readable.on('resume', reset);
    readable.on('pause', suspend);
    readable.once('end', stop);
    readable.once('close', stop);
    reset();
    return stop;
}
