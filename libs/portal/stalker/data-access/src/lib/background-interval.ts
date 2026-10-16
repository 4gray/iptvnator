/**
 * A repeating timer that keeps its cadence while the page is hidden.
 *
 * Chromium throttles timers on a hidden page's main thread, and after five
 * minutes hidden and silent it wakes them at most once per minute. Timers in
 * a dedicated worker are not subject to that page throttling, so the tick
 * runs there and only the callback is posted back. Without `Worker` (tests,
 * or a worker that cannot start) this falls back to a plain `setInterval`.
 *
 * The worker is an inline blob, allowed by the renderer CSP
 * (`worker-src 'self' blob:`), so no bundler entry is needed.
 */
const TICKER_SOURCE = `
let timer;
onmessage = (event) => {
    clearInterval(timer);
    if (event.data > 0) timer = setInterval(() => postMessage(0), event.data);
};
`;

/** Starts calling `callback` every `periodMs`; returns the stop function. */
export function createBackgroundInterval(
    callback: () => void,
    periodMs: number
): () => void {
    let fallback: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const startFallback = () => {
        // A worker error that arrives after stop() must not revive the tick.
        if (stopped) return;
        fallback ??= setInterval(callback, periodMs);
    };
    const ticker = startTickerWorker();
    const stopWorker = () => {
        ticker?.worker.terminate();
        if (ticker) URL.revokeObjectURL(ticker.url);
    };
    if (ticker) {
        ticker.worker.onmessage = () => callback();
        // A worker that cannot load its script (a stricter CSP, say) fails
        // asynchronously; never leave the caller without a tick.
        ticker.worker.onerror = () => {
            stopWorker();
            startFallback();
        };
        ticker.worker.postMessage(periodMs);
    } else {
        startFallback();
    }
    return () => {
        stopped = true;
        if (ticker) {
            ticker.worker.onmessage = null;
            ticker.worker.onerror = null;
        }
        stopWorker();
        if (fallback !== undefined) clearInterval(fallback);
    };
}

function startTickerWorker(): { worker: Worker; url: string } | null {
    if (
        typeof Worker === 'undefined' ||
        typeof URL?.createObjectURL !== 'function'
    ) {
        return null;
    }
    const url = URL.createObjectURL(
        new Blob([TICKER_SOURCE], { type: 'text/javascript' })
    );
    try {
        return { worker: new Worker(url), url };
    } catch {
        URL.revokeObjectURL(url);
        return null;
    }
}
