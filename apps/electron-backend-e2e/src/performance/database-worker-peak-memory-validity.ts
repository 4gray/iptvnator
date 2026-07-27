export const DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON = {
    EXTERNAL_MEMORY_PEAK_INVALID:
        'database-worker-external-memory-peak-invalid',
    EXTERNAL_MEMORY_SAMPLES_MISSING:
        'database-worker-external-memory-samples-missing',
    HEAP_PEAK_INVALID: 'database-worker-heap-peak-invalid',
    HEAP_SAMPLES_MISSING: 'database-worker-heap-samples-missing',
    MULTIPLE_DATABASE_WORKERS: 'multiple-database-workers',
    DATABASE_WORKER_MISSING: 'database-worker-missing',
} as const;

export type DatabaseWorkerPeakMemoryInvalidReason =
    (typeof DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON)[keyof typeof DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON];

export interface DatabaseWorkerPeakMemoryValidity {
    readonly invalidMeasuredRuns: readonly {
        readonly reason: DatabaseWorkerPeakMemoryInvalidReason;
        readonly runId: string;
    }[];
    readonly measuredRunCount: number;
    readonly validForComparison: boolean;
    readonly validMeasuredRunCount: number;
}

interface PeakMemoryWorker {
    readonly externalMemorySampleCount?: unknown;
    readonly heapUsedSampleCount?: unknown;
    readonly kind: string;
    readonly peakExternalBytes: unknown;
    readonly peakExternalUnavailableReason?: unknown;
    readonly peakHeapUsedBytes: unknown;
    readonly peakHeapUsedUnavailableReason?: unknown;
}

interface PeakMemoryIteration {
    readonly kind: string;
    readonly main: {
        readonly workers: readonly PeakMemoryWorker[];
    };
    readonly runId: string;
}

export function assessDatabaseWorkerPeakMemoryValidity(
    iterations: readonly PeakMemoryIteration[]
): DatabaseWorkerPeakMemoryValidity {
    const measured = iterations.filter(
        (iteration) => iteration.kind === 'measured'
    );
    const invalidMeasuredRuns: {
        reason: DatabaseWorkerPeakMemoryInvalidReason;
        runId: string;
    }[] = [];

    for (const iteration of measured) {
        const workers = iteration.main.workers.filter(
            (worker) => worker.kind === 'database.worker'
        );
        const reason = assessWorkers(workers);
        if (reason !== null) {
            invalidMeasuredRuns.push({ reason, runId: iteration.runId });
        }
    }

    return Object.freeze({
        invalidMeasuredRuns: Object.freeze(invalidMeasuredRuns),
        measuredRunCount: measured.length,
        validForComparison:
            measured.length > 0 && invalidMeasuredRuns.length === 0,
        validMeasuredRunCount: measured.length - invalidMeasuredRuns.length,
    });
}

function assessWorkers(
    workers: readonly PeakMemoryWorker[]
): DatabaseWorkerPeakMemoryInvalidReason | null {
    if (workers.length === 0) {
        return DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.DATABASE_WORKER_MISSING;
    }
    if (workers.length !== 1) {
        return DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.MULTIPLE_DATABASE_WORKERS;
    }

    const worker = workers[0];
    if (!worker) {
        return DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.DATABASE_WORKER_MISSING;
    }
    if (!isPositiveSampleCount(worker.heapUsedSampleCount)) {
        return DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.HEAP_SAMPLES_MISSING;
    }
    if (
        !isPeak(worker.peakHeapUsedBytes) ||
        worker.peakHeapUsedUnavailableReason !== null
    ) {
        return DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.HEAP_PEAK_INVALID;
    }
    if (!isPositiveSampleCount(worker.externalMemorySampleCount)) {
        return DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.EXTERNAL_MEMORY_SAMPLES_MISSING;
    }
    if (
        !isPeak(worker.peakExternalBytes) ||
        worker.peakExternalUnavailableReason !== null
    ) {
        return DATABASE_WORKER_PEAK_MEMORY_INVALID_REASON.EXTERNAL_MEMORY_PEAK_INVALID;
    }
    return null;
}

function isPositiveSampleCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function isPeak(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
