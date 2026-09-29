/**
 * Polls activity until nothing has changed for `quietMs` and nothing is in
 * flight. Used by the click-started journeys to settle the app before the
 * click and to close the mock request window after the terminal.
 *
 * A sample is compared as a whole, in-flight counts included, so the poll
 * that first sees pending work complete restarts the quiet period: the
 * window is always at least `quietMs` after the last observed activity,
 * never measured from a poll at which work was still pending.
 */
export interface JourneyQuietWaitOptions<T> {
    /** Requests or calls still pending in a sample; any makes it busy. */
    readonly inFlight: (sample: T) => number;
    readonly now?: () => number;
    readonly pollMs: number;
    readonly quietMs: number;
    readonly sample: () => Promise<T>;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly timeoutError: (last: T) => Error;
    readonly timeoutMs: number;
}

export interface JourneyQuietWaitResult<T> {
    readonly sample: T;
    readonly waitedMs: number;
}

export async function waitForJourneyQuiet<T>(
    options: JourneyQuietWaitOptions<T>
): Promise<JourneyQuietWaitResult<T>> {
    const now = options.now ?? Date.now;
    const sleep =
        options.sleep ??
        ((ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const startedMs = now();
    let lastKey = JSON.stringify(await options.sample());
    let quietSinceMs = now();
    for (;;) {
        await sleep(options.pollMs);
        const next = await options.sample();
        const nextKey = JSON.stringify(next);
        const sampledMs = now();
        // The deadline is checked first: a sample that stalled past it (for
        // example behind a busy main process) must fail the wait, not be
        // accepted as the end of a quiet period nobody observed.
        if (sampledMs - startedMs > options.timeoutMs) {
            throw options.timeoutError(next);
        }
        if (nextKey !== lastKey || options.inFlight(next) > 0) {
            lastKey = nextKey;
            quietSinceMs = sampledMs;
        } else if (sampledMs - quietSinceMs >= options.quietMs) {
            return { sample: next, waitedMs: sampledMs - startedMs };
        }
    }
}
