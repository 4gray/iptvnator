import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    assessDatabaseWorkerPeakMemoryValidity,
    DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON,
} from './database-worker-peak-memory-validity';

describe('database worker peak-memory validity', () => {
    it('requires successful heap and external-memory samples in every measured run', () => {
        const validity = assessDatabaseWorkerPeakMemoryValidity([
            iteration('warmup', 'warmup', worker(0, 0)),
            iteration('run-01', 'measured', worker(3, 4)),
            iteration('diagnostic', 'diagnostic', worker(0, 0)),
        ]);

        assert.deepEqual(validity, {
            invalidMeasuredRuns: [],
            measuredRunCount: 1,
            validForComparison: true,
            validMeasuredRunCount: 1,
        });
    });

    it('fails closed for absent samples instead of accepting initialized zero peaks', () => {
        const missingCounts = assessDatabaseWorkerPeakMemoryValidity([
            iteration('run-01', 'measured', {
                kind: 'database.worker',
                peakExternalBytes: 0,
                peakHeapUsedBytes: 0,
            }),
            iteration('run-02', 'measured', worker(0, 1)),
            iteration('run-03', 'measured', worker(1, 0)),
        ]);

        assert.deepEqual(missingCounts.invalidMeasuredRuns, [
            {
                reason: DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.HEAP_SAMPLES_MISSING,
                runId: 'run-01',
            },
            {
                reason: DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.HEAP_SAMPLES_MISSING,
                runId: 'run-02',
            },
            {
                reason: DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.EXTERNAL_MEMORY_SAMPLES_MISSING,
                runId: 'run-03',
            },
        ]);
        assert.equal(missingCounts.validForComparison, false);
        assert.equal(missingCounts.validMeasuredRunCount, 0);
    });

    it('reports stable worker-cardinality and malformed-peak reasons', () => {
        const validity = assessDatabaseWorkerPeakMemoryValidity([
            { kind: 'measured', main: { workers: [] }, runId: 'missing' },
            {
                kind: 'measured',
                main: { workers: [worker(1, 1), worker(1, 1)] },
                runId: 'multiple',
            },
            iteration('heap-invalid', 'measured', {
                ...worker(1, 1),
                peakHeapUsedBytes: Number.NaN,
            }),
            iteration('external-invalid', 'measured', {
                ...worker(1, 1),
                peakExternalBytes: -1,
            }),
            iteration('heap-reason-incoherent', 'measured', {
                ...worker(1, 1),
                peakHeapUsedUnavailableReason:
                    'worker-heap-used-samples-missing',
            }),
            iteration('external-reason-incoherent', 'measured', {
                ...worker(1, 1),
                peakExternalUnavailableReason:
                    'worker-external-memory-samples-missing',
            }),
        ]);

        assert.deepEqual(
            validity.invalidMeasuredRuns.map(({ reason }) => reason),
            [
                DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.DATABASE_WORKER_MISSING,
                DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.MULTIPLE_DATABASE_WORKERS,
                DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.HEAP_PEAK_INVALID,
                DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.EXTERNAL_MEMORY_PEAK_INVALID,
                DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.HEAP_PEAK_INVALID,
                DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.EXTERNAL_MEMORY_PEAK_INVALID,
            ]
        );
    });
});

function iteration(
    runId: string,
    kind: string,
    databaseWorker: Record<string, unknown>
) {
    return {
        kind,
        main: { workers: [databaseWorker] },
        runId,
    };
}

function worker(
    heapUsedSampleCount: number,
    externalMemorySampleCount: number
) {
    return {
        externalMemorySampleCount,
        heapUsedSampleCount,
        kind: 'database.worker',
        peakExternalBytes: 600,
        peakExternalUnavailableReason: null,
        peakHeapUsedBytes: 1_500,
        peakHeapUsedUnavailableReason: null,
    };
}
