import {
    WORKER_PERFORMANCE_UNAVAILABLE_REASON,
    type WorkerEventLoopDelayHistogram,
    type WorkerEventLoopDelayMetrics,
    type WorkerPerformanceCapture,
    type WorkerPerformanceMetricUnavailableReason,
} from './worker-performance-capture.model';
import {
    HISTOGRAM_POLL_INTERVAL_MS,
    HISTOGRAM_WAIT_CAP_MS,
} from './worker-performance-capture.runtime';

export function disableWorkerPerformanceHistogram(
    capture: WorkerPerformanceCapture
): boolean {
    if (!capture.eventLoopDelay || capture.histogramDisabled) {
        return true;
    }

    try {
        capture.eventLoopDelay.disable();
        capture.histogramDisabled = true;
        return true;
    } catch {
        // Performance instrumentation must never affect worker execution.
        return false;
    }
}

export function markEventLoopDelayUnavailable(
    capture: WorkerPerformanceCapture,
    reason: WorkerPerformanceMetricUnavailableReason
): void {
    capture.eventLoopDelayUnavailableReason ??= reason;
    disableWorkerPerformanceHistogram(capture);
}

export async function waitForHistogramCondition(
    capture: WorkerPerformanceCapture,
    condition: (histogram: WorkerEventLoopDelayHistogram) => boolean
): Promise<boolean> {
    const histogram = capture.eventLoopDelay;
    if (
        !histogram ||
        capture.histogramDisabled ||
        capture.invalidReason !== null
    ) {
        return false;
    }

    let startedAt: number;
    try {
        startedAt = capture.runtime.readMonotonicMs();
    } catch {
        return false;
    }

    const maximumPolls = Math.ceil(
        HISTOGRAM_WAIT_CAP_MS / HISTOGRAM_POLL_INTERVAL_MS
    );
    let pollCount = 0;

    while (true) {
        if (capture.invalidReason !== null || capture.histogramDisabled) {
            return false;
        }
        try {
            if (condition(histogram)) {
                return true;
            }
        } catch {
            return false;
        }

        let elapsedMs: number;
        try {
            elapsedMs = capture.runtime.readMonotonicMs() - startedAt;
        } catch {
            return false;
        }
        if (
            !Number.isFinite(elapsedMs) ||
            elapsedMs >= HISTOGRAM_WAIT_CAP_MS ||
            pollCount >= maximumPolls
        ) {
            return false;
        }

        const delayMs = Math.min(
            HISTOGRAM_POLL_INTERVAL_MS,
            HISTOGRAM_WAIT_CAP_MS - Math.max(0, elapsedMs)
        );
        try {
            pollCount += 1;
            await new Promise<void>((resolvePromise) => {
                capture.runtime.scheduleTimeout(resolvePromise, delayMs);
            });
        } catch {
            return false;
        }
    }
}

export function readWorkerEventLoopDelay(
    capture: WorkerPerformanceCapture
): WorkerEventLoopDelayMetrics | null {
    if (
        capture.invalidReason !== null ||
        capture.eventLoopDelayUnavailableReason !== null ||
        capture.histogramFlushedEpochMs === null ||
        !capture.eventLoopDelay
    ) {
        return null;
    }

    try {
        const metrics: WorkerEventLoopDelayMetrics = {
            maxMs: capture.eventLoopDelay.max / 1e6,
            p95Ms: capture.eventLoopDelay.percentile(95) / 1e6,
            p99Ms: capture.eventLoopDelay.percentile(99) / 1e6,
        };
        if (
            Object.values(metrics).every(
                (value) => Number.isFinite(value) && value >= 0
            )
        ) {
            return metrics;
        }
    } catch {
        // The fixed reason below is intentionally payload-free.
    }

    capture.eventLoopDelayUnavailableReason =
        WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_INVALID;
    return null;
}
