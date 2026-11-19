/**
 * Bounded waits used when the database worker is closed for good (app quit
 * or relaunch). Each one resolves `false` instead of waiting past its budget,
 * so a stuck worker can delay quitting but never block it.
 */

/** How long quit waits for requests the worker already accepted. */
export const DB_WORKER_DRAIN_TIMEOUT_MS = 2000;
/** How long quit waits for the worker to close SQLite and exit. */
export const DB_WORKER_CLOSE_TIMEOUT_MS = 1000;

/**
 * Resolves once every tracked promise has settled, including promises added
 * while waiting (a write the renderer sends from `pagehide` arrives after the
 * drain started). Never rejects.
 */
export async function waitForSettled(
    tracked: ReadonlySet<Promise<unknown>>,
    timeoutMs: number
): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
    });

    try {
        while (tracked.size > 0) {
            const settled = Promise.allSettled([...tracked]).then(() => true);
            if (!(await Promise.race([settled, timeout]))) {
                return false;
            }
        }
        return true;
    } finally {
        clearTimeout(timer);
    }
}

type ExitEmitter = {
    once(event: 'exit', listener: () => void): unknown;
    off(event: 'exit', listener: () => void): unknown;
};

/** Resolves `true` when the worker emits `exit` within the budget. */
export function waitForWorkerExit(
    worker: ExitEmitter,
    timeoutMs: number
): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const onExit = () => {
            clearTimeout(timer);
            resolve(true);
        };
        const timer = setTimeout(() => {
            worker.off('exit', onExit);
            resolve(false);
        }, timeoutMs);
        worker.once('exit', onExit);
    });
}
