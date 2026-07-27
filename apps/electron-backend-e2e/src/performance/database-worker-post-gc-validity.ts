import {
    type DatabaseWorkerPostGcValidity,
    type InvalidDatabaseWorkerPostGcMeasuredRun,
    WORKER_POST_GC_HEAP_UNAVAILABLE_REASON,
} from './m3u-refresh-cancellation-contract';

export interface DatabaseWorkerPostGcValidityWorker {
    readonly kind: string;
    readonly postGcHeapUnavailableReason: unknown;
    readonly postGcHeapUsedBytes: unknown;
}

export interface DatabaseWorkerPostGcValidityIteration {
    readonly cancellationEffectObserved?: boolean;
    readonly kind: string;
    readonly main: {
        readonly timeline?: readonly {
            readonly type: string;
        }[];
        readonly workers: readonly DatabaseWorkerPostGcValidityWorker[];
    };
    readonly runId: string;
}

const UNAVAILABLE_REASONS = new Set<string>(
    Object.values(WORKER_POST_GC_HEAP_UNAVAILABLE_REASON)
);

export function assessDatabaseWorkerPostGcValidity(
    iterations: readonly DatabaseWorkerPostGcValidityIteration[]
): DatabaseWorkerPostGcValidity {
    const measured = iterations.filter(
        (iteration) => iteration.kind === 'measured'
    );
    const invalidMeasuredRuns: InvalidDatabaseWorkerPostGcMeasuredRun[] = [];
    const notApplicableMeasuredRuns: {
        readonly reason: 'operation-cancelled-before-database-phase';
        readonly runId: string;
    }[] = [];
    let applicableMeasuredRunCount = 0;
    let validMeasuredRunCount = 0;

    for (const iteration of measured) {
        const databaseWorkers = iteration.main.workers.filter(
            (worker) => worker.kind === 'database.worker'
        );
        const timeline = iteration.main.timeline ?? [];
        const lateDatabaseRequest = timeline.some(
            (record) => record.type === 'db-request-after-capture-cutoff'
        );
        const databasePhaseObserved =
            lateDatabaseRequest ||
            timeline.some((record) => record.type === 'db-request');

        if (lateDatabaseRequest) {
            applicableMeasuredRunCount += 1;
            invalidMeasuredRuns.push({
                databaseWorkerCount: databaseWorkers.length,
                reason: WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.DATABASE_WORKER_ACTIVITY_AFTER_CUTOFF,
                runId: iteration.runId,
            });
            continue;
        }

        if (iteration.cancellationEffectObserved === true) {
            if (!databasePhaseObserved && databaseWorkers.length === 0) {
                notApplicableMeasuredRuns.push({
                    reason: 'operation-cancelled-before-database-phase',
                    runId: iteration.runId,
                });
                continue;
            }

            applicableMeasuredRunCount += 1;
            invalidMeasuredRuns.push({
                databaseWorkerCount: databaseWorkers.length,
                reason: WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.DATABASE_WORKER_UNEXPECTED_ACTIVITY,
                runId: iteration.runId,
            });
            continue;
        }

        if (databaseWorkers.length === 0) {
            applicableMeasuredRunCount += 1;
            invalidMeasuredRuns.push({
                databaseWorkerCount: 0,
                reason: WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.DATABASE_WORKER_MISSING,
                runId: iteration.runId,
            });
            continue;
        }

        applicableMeasuredRunCount += 1;
        if (databaseWorkers.length !== 1) {
            invalidMeasuredRuns.push({
                databaseWorkerCount: databaseWorkers.length,
                reason: WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.MULTIPLE_DATABASE_WORKERS,
                runId: iteration.runId,
            });
            continue;
        }

        const worker = databaseWorkers[0] as DatabaseWorkerPostGcValidityWorker;
        const heap = worker.postGcHeapUsedBytes;
        const reason = worker.postGcHeapUnavailableReason;
        if (
            Number.isSafeInteger(heap) &&
            Number(heap) >= 0 &&
            reason === null
        ) {
            validMeasuredRunCount += 1;
            continue;
        }

        invalidMeasuredRuns.push({
            databaseWorkerCount: 1,
            reason:
                heap === null &&
                typeof reason === 'string' &&
                UNAVAILABLE_REASONS.has(reason)
                    ? reason
                    : WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.INVALID_CAPTURE,
            runId: iteration.runId,
        });
    }

    return Object.freeze({
        applicableMeasuredRunCount,
        invalidMeasuredRuns: Object.freeze(invalidMeasuredRuns),
        measuredRunCount: measured.length,
        notApplicableMeasuredRuns: Object.freeze(notApplicableMeasuredRuns),
        validForBenchmark:
            measured.length > 0 && invalidMeasuredRuns.length === 0,
        validForComparison:
            measured.length > 0 &&
            applicableMeasuredRunCount === measured.length &&
            validMeasuredRunCount === measured.length &&
            invalidMeasuredRuns.length === 0,
        validMeasuredRunCount,
    });
}
