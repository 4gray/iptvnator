import type {
    WorkerCaptureMetrics,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import {
    PERFORMANCE_ITERATION_KIND,
    PERFORMANCE_WORKER_KIND,
} from './m3u-refresh-cancellation-contract';

export const DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON = {
    DATABASE_WORKER_MISSING: 'database-worker-missing',
    EVENT_LOOP_DELAY_INVALID: 'event-loop-delay-invalid',
    EVENT_LOOP_UTILIZATION_INVALID: 'event-loop-utilization-invalid',
    MULTIPLE_DATABASE_WORKERS: 'multiple-database-workers',
    REQUEST_SET_INVALID: 'initial-import-request-set-invalid',
    THREAD_CPU_INVALID: 'thread-cpu-invalid',
    WORKER_CAPTURE_INVALID: 'worker-performance-capture-invalid',
} as const;

export type DatabaseWorkerRequestMetricsInvalidReason =
    (typeof DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON)[keyof typeof DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON];

export interface DatabaseWorkerRequestMetricsValidity {
    readonly expectedRequestCount: number;
    readonly invalidRequests: readonly {
        readonly operation: string | null;
        readonly reason: DatabaseWorkerRequestMetricsInvalidReason;
        readonly runId: string;
    }[];
    readonly measuredRunCount: number;
    readonly validForComparison: boolean;
    readonly validMeasuredRunCount: number;
    readonly validRequestCount: number;
}

interface RequestMetricsIteration {
    readonly kind: string;
    readonly main: {
        readonly workers: readonly WorkerCaptureMetrics[];
    };
    readonly runId: string;
}

export function assessDatabaseWorkerRequestMetricsValidity(
    iterations: readonly RequestMetricsIteration[]
): DatabaseWorkerRequestMetricsValidity {
    const measured = iterations.filter(
        (iteration) =>
            iteration.kind === PERFORMANCE_ITERATION_KIND.MEASURED
    );
    const invalidRequests: {
        operation: string | null;
        reason: DatabaseWorkerRequestMetricsInvalidReason;
        runId: string;
    }[] = [];
    let validMeasuredRunCount = 0;
    let validRequestCount = 0;

    for (const iteration of measured) {
        const workers = iteration.main.workers.filter(
            (worker) => worker.kind === PERFORMANCE_WORKER_KIND.DATABASE
        );
        if (workers.length === 0) {
            invalidRequests.push({
                operation: null,
                reason: DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.DATABASE_WORKER_MISSING,
                runId: iteration.runId,
            });
            continue;
        }
        const worker = workers.length === 1 ? workers[0] : null;
        if (!worker) {
            invalidRequests.push({
                operation: null,
                reason: DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.MULTIPLE_DATABASE_WORKERS,
                runId: iteration.runId,
            });
            continue;
        }
        const requests = requireInitialImportRequestPair(worker);
        if (requests === null) {
            invalidRequests.push({
                operation: null,
                reason: DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.REQUEST_SET_INVALID,
                runId: iteration.runId,
            });
            continue;
        }

        let runIsValid = true;
        for (const request of requests) {
            const reason = assessRequest(request);
            if (reason === null) {
                validRequestCount += 1;
            } else {
                runIsValid = false;
                invalidRequests.push({
                    operation: request.operation,
                    reason,
                    runId: iteration.runId,
                });
            }
        }
        if (runIsValid) {
            validMeasuredRunCount += 1;
        }
    }

    const expectedRequestCount = measured.length * 2;
    return Object.freeze({
        expectedRequestCount,
        invalidRequests: Object.freeze(invalidRequests),
        measuredRunCount: measured.length,
        validForComparison:
            measured.length > 0 &&
            validMeasuredRunCount === measured.length &&
            validRequestCount === expectedRequestCount,
        validMeasuredRunCount,
        validRequestCount,
    });
}

function requireInitialImportRequestPair(
    worker: WorkerCaptureMetrics
): readonly [
    WorkerRequestPerformanceMetrics,
    WorkerRequestPerformanceMetrics,
] | null {
    const upserts = worker.requests.filter(
        (request) =>
            request.operation === 'DB_UPSERT_APP_PLAYLIST' && request.success
    );
    const gets = worker.requests.filter(
        (request) =>
            request.operation === 'DB_GET_APP_PLAYLIST' && request.success
    );
    return worker.requests.length === 2 &&
        upserts.length === 1 &&
        upserts[0] &&
        gets.length === 1 &&
        gets[0]
        ? [upserts[0], gets[0]]
        : null;
}

function assessRequest(
    request: WorkerRequestPerformanceMetrics
): DatabaseWorkerRequestMetricsInvalidReason | null {
    if (
        request.performanceCaptureUnavailableReason !== null ||
        request.invalidReason !== null
    ) {
        return DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.WORKER_CAPTURE_INVALID;
    }
    if (
        request.eventLoopDelayUnavailableReason !== null ||
        request.histogramFlushedEpochMs === null ||
        !isEventLoopDelay(request.eventLoopDelay)
    ) {
        return DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.EVENT_LOOP_DELAY_INVALID;
    }
    if (
        request.eventLoopUtilizationUnavailableReason !== null ||
        !isUtilization(request.eventLoopUtilization)
    ) {
        return DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.EVENT_LOOP_UTILIZATION_INVALID;
    }
    if (
        request.threadCpuUnavailableReason !== null ||
        !isFiniteNonNegative(request.threadCpuSystemMicros) ||
        !isFiniteNonNegative(request.threadCpuUserMicros)
    ) {
        return DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.THREAD_CPU_INVALID;
    }
    return null;
}

function isEventLoopDelay(
    value: WorkerRequestPerformanceMetrics['eventLoopDelay']
): value is NonNullable<WorkerRequestPerformanceMetrics['eventLoopDelay']> {
    return (
        value !== null &&
        isFiniteNonNegative(value.maxMs) &&
        isFiniteNonNegative(value.p95Ms) &&
        isFiniteNonNegative(value.p99Ms) &&
        value.p95Ms <= value.p99Ms &&
        value.p99Ms <= value.maxMs
    );
}

function isUtilization(value: number | null): value is number {
    return isFiniteNonNegative(value) && value <= 1;
}

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
