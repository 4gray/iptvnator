import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    assessDatabaseWorkerRequestMetricsValidity,
    DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON,
} from './database-worker-request-metrics-validity';
import { createCompleteTestMainCapture } from './m3u-import-report.test-helpers';
import type {
    WorkerCaptureMetrics,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';

describe('database worker request-metrics validity', () => {
    it('requires exactly two complete request samples in every measured run', () => {
        const worker = completeWorker();
        const validity = assessDatabaseWorkerRequestMetricsValidity([
            iteration('warmup', 'warmup', [worker]),
            iteration('run-01', 'measured', [worker]),
            iteration('run-02', 'measured', [worker]),
            iteration('diagnostic', 'diagnostic', [worker]),
        ]);

        assert.deepEqual(validity, {
            expectedRequestCount: 4,
            invalidRequests: [],
            measuredRunCount: 2,
            validForComparison: true,
            validMeasuredRunCount: 2,
            validRequestCount: 4,
        });
    });

    it('fails each measured run with missing ELD, ELU, CPU, or raw capture metrics', () => {
        const validity = assessDatabaseWorkerRequestMetricsValidity([
            invalidRequestIteration('run-eld', {
                eventLoopDelay: null,
                eventLoopDelayUnavailableReason:
                    'event-loop-delay-capture-unavailable',
                histogramFlushedEpochMs: null,
            }),
            invalidRequestIteration('run-elu', {
                eventLoopUtilization: null,
                eventLoopUtilizationUnavailableReason:
                    'event-loop-utilization-unavailable',
            }),
            invalidRequestIteration('run-cpu', {
                threadCpuSystemMicros: null,
                threadCpuUnavailableReason: 'thread-cpu-usage-unavailable',
                threadCpuUserMicros: null,
            }),
            invalidRequestIteration('run-capture', {
                performanceCaptureUnavailableReason:
                    'worker-performance-capture-invalid',
            }),
        ]);

        assert.equal(validity.expectedRequestCount, 8);
        assert.equal(validity.validRequestCount, 4);
        assert.equal(validity.validMeasuredRunCount, 0);
        assert.equal(validity.validForComparison, false);
        assert.deepEqual(
            validity.invalidRequests.map(({ reason }) => reason),
            [
                DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.EVENT_LOOP_DELAY_INVALID,
                DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.EVENT_LOOP_UTILIZATION_INVALID,
                DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.THREAD_CPU_INVALID,
                DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.WORKER_CAPTURE_INVALID,
            ]
        );
    });

    it('fails closed for missing, multiple, and wrong request sets', () => {
        const worker = completeWorker();
        const validity = assessDatabaseWorkerRequestMetricsValidity([
            iteration('missing', 'measured', []),
            iteration('multiple', 'measured', [worker, worker]),
            iteration('wrong-requests', 'measured', [
                {
                    ...worker,
                    requests: worker.requests.slice(0, 1),
                },
            ]),
        ]);

        assert.equal(validity.expectedRequestCount, 6);
        assert.equal(validity.validRequestCount, 0);
        assert.equal(validity.validForComparison, false);
        assert.deepEqual(
            validity.invalidRequests.map(({ reason }) => reason),
            [
                DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.DATABASE_WORKER_MISSING,
                DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.MULTIPLE_DATABASE_WORKERS,
                DATABASE_WORKER_REQUEST_METRICS_INVALID_REASON.REQUEST_SET_INVALID,
            ]
        );
    });
});

function completeWorker(): WorkerCaptureMetrics {
    const worker = createCompleteTestMainCapture().workers[0];
    assert.ok(worker);
    return worker;
}

function invalidRequestIteration(
    runId: string,
    updates: Partial<WorkerRequestPerformanceMetrics>
) {
    const worker = completeWorker();
    const get = worker.requests[1];
    assert.ok(get);
    return iteration(runId, 'measured', [
        {
            ...worker,
            requests: [worker.requests[0], { ...get, ...updates }],
        },
    ]);
}

function iteration(
    runId: string,
    kind: string,
    workers: readonly WorkerCaptureMetrics[]
) {
    return { kind, main: { workers }, runId };
}
