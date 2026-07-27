import {
    WORKER_PERFORMANCE_INVALID_REASON,
    WORKER_PERFORMANCE_UNAVAILABLE_REASON,
    type WorkerPerformanceCapture,
    type WorkerPerformanceCaptureOptions,
    type WorkerPerformanceCaptureResult,
    type WorkerPerformanceExecutionResult,
} from './worker-performance-capture.model';
import {
    disableWorkerPerformanceHistogram,
    markEventLoopDelayUnavailable,
    waitForHistogramCondition,
} from './worker-performance-capture.histogram';
import {
    beginWorkerPerformanceCapture,
    createWorkerPerformanceCaptureResult,
    finishWorkerPerformanceMetricBoundaries,
} from './worker-performance-capture.metrics';
import {
    DEFAULT_WORKER_PERFORMANCE_RUNTIME,
    safeReadEpochMs,
    WORKER_PROFILING_ENV,
} from './worker-performance-capture.runtime';

export {
    WORKER_PERFORMANCE_INVALID_REASON,
    WORKER_PERFORMANCE_UNAVAILABLE_REASON,
} from './worker-performance-capture.model';
export type {
    WorkerEventLoopDelayHistogram,
    WorkerEventLoopDelayMetrics,
    WorkerPerformanceCapture,
    WorkerPerformanceCaptureOptions,
    WorkerPerformanceCaptureResult,
    WorkerPerformanceCaptureRuntime,
    WorkerPerformanceExecutionResult,
    WorkerPerformanceInvalidReason,
    WorkerPerformanceUnavailableReason,
} from './worker-performance-capture.model';

export function startWorkerPerformanceCapture(
    options: WorkerPerformanceCaptureOptions = {}
): WorkerPerformanceCapture | null {
    const enabled =
        options.enabled ?? process.env[WORKER_PROFILING_ENV] === '1';
    if (!enabled) {
        return null;
    }

    const runtime = options.runtime ?? DEFAULT_WORKER_PERFORMANCE_RUNTIME;
    const capture: WorkerPerformanceCapture = {
        eventLoopDelay: null,
        eventLoopDelayUnavailableReason: null,
        eventLoopUtilizationEnd: null,
        eventLoopUtilizationStart: null,
        eventLoopUtilizationUnavailableReason: null,
        histogramDisabled: false,
        histogramFlushedEpochMs: null,
        invalidReason: null,
        phaseEvents: [],
        requestReceivedEpochMs: safeReadEpochMs(runtime),
        requestId:
            typeof options.requestId === 'string' &&
            options.requestId.length > 0
                ? options.requestId
                : null,
        runtime,
        threadCpuEnd: null,
        threadCpuStart: null,
        threadCpuUnavailableReason:
            runtime.readThreadCpuUsage === null
                ? WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_UNAVAILABLE
                : null,
        workEndedEpochMs: null,
        workStartedEpochMs: null,
    };

    try {
        capture.eventLoopDelay = runtime.createEventLoopDelayHistogram();
        capture.eventLoopDelay.enable();
    } catch {
        capture.eventLoopDelay = null;
        capture.eventLoopDelayUnavailableReason =
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE;
    }

    return capture;
}

export async function armWorkerPerformanceCapture(
    capture: WorkerPerformanceCapture | null
): Promise<void> {
    if (!capture) {
        return;
    }

    try {
        if (
            capture.invalidReason !== null ||
            capture.eventLoopDelayUnavailableReason !== null
        ) {
            return;
        }
        const armed = await waitForHistogramCondition(
            capture,
            (histogram) => histogram.count > 0
        );
        if (!armed && capture.invalidReason === null) {
            markEventLoopDelayUnavailable(
                capture,
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_ARM_TIMEOUT
            );
        }
    } catch {
        try {
            markEventLoopDelayUnavailable(
                capture,
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE
            );
        } catch {
            // Instrumentation must never prevent business execution.
        }
    }
}

export async function finishWorkerPerformanceCapture(
    capture: WorkerPerformanceCapture | null
): Promise<WorkerPerformanceCaptureResult | undefined> {
    if (!capture) {
        return undefined;
    }

    finishWorkerPerformanceMetricBoundaries(capture);

    if (
        capture.invalidReason === null &&
        capture.eventLoopDelayUnavailableReason === null &&
        capture.eventLoopDelay
    ) {
        try {
            const workEndedHistogramCount = capture.eventLoopDelay.count;
            const flushed = await waitForHistogramCondition(
                capture,
                (histogram) => histogram.count > workEndedHistogramCount
            );
            if (flushed) {
                const disabled = disableWorkerPerformanceHistogram(capture);
                if (disabled) {
                    capture.histogramFlushedEpochMs = safeReadEpochMs(
                        capture.runtime
                    );
                } else {
                    markEventLoopDelayUnavailable(
                        capture,
                        WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE
                    );
                }
            } else if (
                capture.invalidReason === null &&
                capture.eventLoopDelayUnavailableReason === null
            ) {
                markEventLoopDelayUnavailable(
                    capture,
                    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_FLUSH_TIMEOUT
                );
            }
        } catch {
            markEventLoopDelayUnavailable(
                capture,
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE
            );
        }
    } else {
        disableWorkerPerformanceHistogram(capture);
    }

    return createWorkerPerformanceCaptureResult(capture);
}

export async function executeWithWorkerPerformanceCapture<TResult>(
    capture: WorkerPerformanceCapture | null,
    execute: () => Promise<TResult>,
    finish: (
        capture: WorkerPerformanceCapture | null
    ) => Promise<
        WorkerPerformanceCaptureResult | undefined
    > = finishWorkerPerformanceCapture
): Promise<WorkerPerformanceExecutionResult<TResult>> {
    try {
        beginWorkerPerformanceCapture(capture);
    } catch {
        // Instrumentation setup must never prevent business execution.
    }
    let result: TResult;
    try {
        result = await execute();
    } catch (error) {
        const performance = await safelyFinishWorkerPerformanceCapture(
            capture,
            finish
        );
        return {
            error,
            performance,
            result: undefined,
            success: false,
        };
    }

    const performance = await safelyFinishWorkerPerformanceCapture(
        capture,
        finish
    );
    return {
        error: null,
        performance,
        result,
        success: true,
    };
}

async function safelyFinishWorkerPerformanceCapture(
    capture: WorkerPerformanceCapture | null,
    finish: (
        capture: WorkerPerformanceCapture | null
    ) => Promise<WorkerPerformanceCaptureResult | undefined>
): Promise<WorkerPerformanceCaptureResult | undefined> {
    try {
        return await finish(capture);
    } catch {
        if (!capture) {
            return undefined;
        }
        try {
            if (capture.workEndedEpochMs === null) {
                finishWorkerPerformanceMetricBoundaries(capture);
            }
            markEventLoopDelayUnavailable(
                capture,
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE
            );
            return createWorkerPerformanceCaptureResult(capture);
        } catch {
            return undefined;
        }
    }
}

export function registerDatabaseWorkerPerformanceCapture(
    activeCaptures: Set<WorkerPerformanceCapture>,
    capture: WorkerPerformanceCapture | null
): void {
    if (!capture) {
        return;
    }

    if (activeCaptures.size > 0) {
        for (const activeCapture of activeCaptures) {
            activeCapture.invalidReason =
                WORKER_PERFORMANCE_INVALID_REASON.OVERLAPPING_DATABASE_WORKER_REQUESTS;
            disableWorkerPerformanceHistogram(activeCapture);
        }
        capture.invalidReason =
            WORKER_PERFORMANCE_INVALID_REASON.OVERLAPPING_DATABASE_WORKER_REQUESTS;
        disableWorkerPerformanceHistogram(capture);
    }
    activeCaptures.add(capture);
}

export function releaseDatabaseWorkerPerformanceCapture(
    activeCaptures: Set<WorkerPerformanceCapture>,
    capture: WorkerPerformanceCapture | null
): void {
    if (capture) {
        activeCaptures.delete(capture);
    }
}

export function stampWorkerPerformanceResponsePostedEpoch(
    capture: WorkerPerformanceCapture | null,
    performance: WorkerPerformanceCaptureResult | undefined
): WorkerPerformanceCaptureResult | undefined {
    if (!capture || !performance) {
        return performance;
    }

    try {
        return {
            ...performance,
            responsePostedEpochMs: safeReadEpochMs(capture.runtime),
        };
    } catch {
        return performance;
    }
}
