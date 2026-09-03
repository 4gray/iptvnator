/**
 * Coalesces the progress reports of one tracked database operation.
 *
 * Every report used to become a worker message, a main-process forward and a
 * renderer signal write. A 300k-row catalog delete produced thousands of them
 * in a few seconds, each one re-rendering the busy overlay (#1292). The
 * throttle lets one through every `minIntervalMs` and folds the rest into the
 * next emitted event, while keeping the transitions the UI must not miss:
 *
 * - the first report, and every report that starts a new phase, go out at
 *   once — a pending report from the previous phase is emitted first, so a
 *   phase never ends with its last numbers unseen;
 * - a report that reaches its total goes out at once;
 * - `flush()` hands back whatever is still pending, for the caller to emit
 *   before a terminal event.
 *
 * Coalescing keeps the latest `phase`/`current`/`total` and sums `increment`,
 * so a consumer adding increments together still arrives at the same count.
 */
export interface ThrottledProgressUpdate {
    readonly phase: string;
    readonly current?: number;
    readonly total?: number;
    readonly increment?: number;
}

export interface ProgressEventThrottle {
    /** Progress events to emit now, in order. Empty when coalesced. */
    push(progress: ThrottledProgressUpdate): ThrottledProgressUpdate[];
    /** The coalesced event still waiting, if any. Clears it. */
    flush(): ThrottledProgressUpdate[];
}

export interface ProgressEventThrottleOptions {
    readonly minIntervalMs: number;
    /** Clock, injectable for tests. Defaults to `Date.now`. */
    readonly now?: () => number;
}

function mergeProgress(
    pending: ThrottledProgressUpdate | null,
    next: ThrottledProgressUpdate
): ThrottledProgressUpdate {
    if (!pending) {
        return next;
    }

    const increment =
        pending.increment === undefined && next.increment === undefined
            ? undefined
            : (pending.increment ?? 0) + (next.increment ?? 0);

    return {
        phase: next.phase,
        current: next.current ?? pending.current,
        total: next.total ?? pending.total,
        increment,
    };
}

function reachedTotal(progress: ThrottledProgressUpdate): boolean {
    return (
        progress.total !== undefined &&
        progress.current !== undefined &&
        progress.current >= progress.total
    );
}

export function createProgressEventThrottle(
    options: ProgressEventThrottleOptions
): ProgressEventThrottle {
    const now = options.now ?? Date.now;
    let pending: ThrottledProgressUpdate | null = null;
    let lastEmittedAt = Number.NEGATIVE_INFINITY;
    let lastEmittedPhase: string | undefined;

    const emit = (
        progress: ThrottledProgressUpdate,
        at: number
    ): ThrottledProgressUpdate => {
        pending = null;
        lastEmittedAt = at;
        lastEmittedPhase = progress.phase;
        return progress;
    };

    return {
        push(progress) {
            const events: ThrottledProgressUpdate[] = [];
            const at = now();

            if (pending && pending.phase !== progress.phase) {
                events.push(emit(pending, at));
            }

            const merged = mergeProgress(pending, progress);
            const startsPhase = merged.phase !== lastEmittedPhase;
            const intervalElapsed = at - lastEmittedAt >= options.minIntervalMs;

            if (startsPhase || reachedTotal(merged) || intervalElapsed) {
                events.push(emit(merged, at));
            } else {
                pending = merged;
            }

            return events;
        },
        flush() {
            if (!pending) {
                return [];
            }
            return [emit(pending, now())];
        },
    };
}
