import type { EventLoopUtilization } from 'node:perf_hooks';
import {
    WORKER_PERFORMANCE_UNAVAILABLE_REASON,
    type WorkerPerformanceCapture,
    type WorkerPerformanceCaptureResult,
} from './worker-performance-capture.model';
import { readWorkerEventLoopDelay } from './worker-performance-capture.histogram';
import { safeReadEpochMs } from './worker-performance-capture.runtime';

function readThreadCpuBoundary(
    capture: WorkerPerformanceCapture
): NodeJS.CpuUsage | null {
    if (!capture.runtime.readThreadCpuUsage) {
        capture.threadCpuUnavailableReason ??=
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_UNAVAILABLE;
        return null;
    }

    try {
        const usage = capture.runtime.readThreadCpuUsage();
        if (
            !Number.isFinite(usage.system) ||
            !Number.isFinite(usage.user) ||
            usage.system < 0 ||
            usage.user < 0
        ) {
            capture.threadCpuUnavailableReason =
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_INVALID;
            return null;
        }
        return usage;
    } catch {
        capture.threadCpuUnavailableReason =
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_UNAVAILABLE;
        return null;
    }
}

function readEventLoopUtilizationBoundary(
    capture: WorkerPerformanceCapture
): EventLoopUtilization | null {
    try {
        const utilization = capture.runtime.readEventLoopUtilization();
        if (
            !Number.isFinite(utilization.active) ||
            !Number.isFinite(utilization.idle)
        ) {
            capture.eventLoopUtilizationUnavailableReason =
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_UTILIZATION_UNAVAILABLE;
            return null;
        }
        return utilization;
    } catch {
        capture.eventLoopUtilizationUnavailableReason =
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_UTILIZATION_UNAVAILABLE;
        return null;
    }
}

export function beginWorkerPerformanceCapture(
    capture: WorkerPerformanceCapture | null
): void {
    if (!capture) {
        return;
    }

    capture.workStartedEpochMs = safeReadEpochMs(capture.runtime);
    capture.threadCpuStart = readThreadCpuBoundary(capture);
    capture.eventLoopUtilizationStart =
        readEventLoopUtilizationBoundary(capture);
}

function calculateThreadCpu(
    capture: WorkerPerformanceCapture
): Pick<
    WorkerPerformanceCaptureResult,
    'threadCpuSystemMicros' | 'threadCpuUserMicros'
> {
    if (
        capture.invalidReason !== null ||
        capture.threadCpuUnavailableReason !== null ||
        !capture.threadCpuStart ||
        !capture.threadCpuEnd
    ) {
        return {
            threadCpuSystemMicros: null,
            threadCpuUserMicros: null,
        };
    }

    try {
        const system =
            capture.threadCpuEnd.system - capture.threadCpuStart.system;
        const user = capture.threadCpuEnd.user - capture.threadCpuStart.user;
        if (
            !Number.isFinite(system) ||
            !Number.isFinite(user) ||
            system < 0 ||
            user < 0
        ) {
            capture.threadCpuUnavailableReason =
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_INVALID;
            return {
                threadCpuSystemMicros: null,
                threadCpuUserMicros: null,
            };
        }

        return {
            threadCpuSystemMicros: system,
            threadCpuUserMicros: user,
        };
    } catch {
        capture.threadCpuUnavailableReason =
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_INVALID;
        return {
            threadCpuSystemMicros: null,
            threadCpuUserMicros: null,
        };
    }
}

function calculateEventLoopUtilization(
    capture: WorkerPerformanceCapture
): number | null {
    if (
        capture.invalidReason !== null ||
        capture.eventLoopUtilizationUnavailableReason !== null ||
        !capture.eventLoopUtilizationStart ||
        !capture.eventLoopUtilizationEnd
    ) {
        return null;
    }

    try {
        const active =
            capture.eventLoopUtilizationEnd.active -
            capture.eventLoopUtilizationStart.active;
        const idle =
            capture.eventLoopUtilizationEnd.idle -
            capture.eventLoopUtilizationStart.idle;
        const total = active + idle;
        if (
            !Number.isFinite(active) ||
            !Number.isFinite(idle) ||
            active < 0 ||
            idle < 0 ||
            total < 0
        ) {
            capture.eventLoopUtilizationUnavailableReason =
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_UTILIZATION_UNAVAILABLE;
            return null;
        }

        return total === 0 ? 0 : active / total;
    } catch {
        capture.eventLoopUtilizationUnavailableReason =
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_UTILIZATION_UNAVAILABLE;
        return null;
    }
}

function createFallbackResult(
    capture: WorkerPerformanceCapture
): WorkerPerformanceCaptureResult {
    const invalidReason = capture.invalidReason;
    return {
        eventLoopDelay: null,
        eventLoopDelayUnavailableReason:
            invalidReason ??
            capture.eventLoopDelayUnavailableReason ??
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE,
        eventLoopUtilization: null,
        eventLoopUtilizationUnavailableReason:
            invalidReason ??
            capture.eventLoopUtilizationUnavailableReason ??
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_UTILIZATION_UNAVAILABLE,
        histogramFlushedEpochMs: null,
        invalidReason,
        requestReceivedEpochMs: capture.requestReceivedEpochMs,
        threadCpuSystemMicros: null,
        threadCpuUnavailableReason:
            invalidReason ??
            capture.threadCpuUnavailableReason ??
            WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_UNAVAILABLE,
        threadCpuUserMicros: null,
        workEndedEpochMs:
            capture.workEndedEpochMs ?? capture.requestReceivedEpochMs,
        workStartedEpochMs:
            capture.workStartedEpochMs ?? capture.requestReceivedEpochMs,
    };
}

export function createWorkerPerformanceCaptureResult(
    capture: WorkerPerformanceCapture
): WorkerPerformanceCaptureResult {
    try {
        const overlapReason = capture.invalidReason;
        if (overlapReason) {
            capture.eventLoopDelayUnavailableReason = overlapReason;
            capture.eventLoopUtilizationUnavailableReason = overlapReason;
            capture.threadCpuUnavailableReason = overlapReason;
            capture.histogramFlushedEpochMs = null;
        }
        const threadCpu = calculateThreadCpu(capture);

        return {
            eventLoopDelay: readWorkerEventLoopDelay(capture),
            eventLoopDelayUnavailableReason:
                capture.eventLoopDelayUnavailableReason,
            eventLoopUtilization: calculateEventLoopUtilization(capture),
            eventLoopUtilizationUnavailableReason:
                capture.eventLoopUtilizationUnavailableReason,
            histogramFlushedEpochMs: capture.histogramFlushedEpochMs,
            invalidReason: capture.invalidReason,
            requestReceivedEpochMs: capture.requestReceivedEpochMs,
            ...threadCpu,
            threadCpuUnavailableReason: capture.threadCpuUnavailableReason,
            workEndedEpochMs:
                capture.workEndedEpochMs ?? capture.requestReceivedEpochMs,
            workStartedEpochMs:
                capture.workStartedEpochMs ?? capture.requestReceivedEpochMs,
        };
    } catch {
        return createFallbackResult(capture);
    }
}

export function finishWorkerPerformanceMetricBoundaries(
    capture: WorkerPerformanceCapture
): void {
    capture.workEndedEpochMs = safeReadEpochMs(capture.runtime);
    capture.threadCpuEnd = readThreadCpuBoundary(capture);
    capture.eventLoopUtilizationEnd = readEventLoopUtilizationBoundary(capture);
}
