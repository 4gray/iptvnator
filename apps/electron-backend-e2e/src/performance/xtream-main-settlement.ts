import {
    expectedXtreamWorkerRequestInventory,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import type {
    XtreamMainCaptureOperationOutcomeKind,
    XtreamMainCaptureStatus,
} from './m3u-refresh-main-capture';

interface ExpectedOutcome {
    readonly count: number;
    readonly outcome: Exclude<XtreamMainCaptureOperationOutcomeKind, 'pending'>;
}

export function isXtreamMainCaptureSettled(
    status: XtreamMainCaptureStatus,
    scenarioId: XtreamScenarioId
): boolean {
    try {
        assertCaptureBoundary(status);
        const expected = expectedOutcomes(scenarioId);
        const observed = new Map<
            string,
            { error: number; pending: number; success: number }
        >();
        for (const entry of status.operationOutcomes) {
            const expectation = expected.get(entry.operation);
            if (!expectation) invalid();
            const counts = observed.get(entry.operation) ?? {
                error: 0,
                pending: 0,
                success: 0,
            };
            if (counts[entry.outcome] !== 0) invalid();
            counts[entry.outcome] = entry.count;
            if (
                counts.error + counts.pending + counts.success >
                    expectation.count ||
                (expectation.outcome === 'success' && counts.error > 0) ||
                (expectation.outcome === 'error' && counts.success > 0)
            ) {
                invalid();
            }
            observed.set(entry.operation, counts);
        }
        for (const active of status.activeOperations) {
            if (!expected.has(active.operation)) invalid();
        }
        if (
            status.databaseWorkerCount === 0 ||
            status.activeOperations.length > 0
        ) {
            return false;
        }
        for (const [operation, expectation] of expected) {
            const counts = observed.get(operation);
            if (
                !counts ||
                counts.pending !== 0 ||
                counts[expectation.outcome] !== expectation.count ||
                counts.error + counts.success !== expectation.count
            ) {
                return false;
            }
        }
        return observed.size === expected.size;
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'xtream-main-settlement-invalid'
        ) {
            throw error;
        }
        invalid();
    }
}

function expectedOutcomes(
    scenarioId: XtreamScenarioId
): ReadonlyMap<string, ExpectedOutcome> {
    const expected = new Map<string, ExpectedOutcome>();
    for (const entry of expectedXtreamWorkerRequestInventory(scenarioId)) {
        if (expected.has(entry.operation)) invalid();
        expected.set(entry.operation, {
            count: entry.count,
            outcome: entry.success ? 'success' : 'error',
        });
    }
    return expected;
}

function assertCaptureBoundary(status: XtreamMainCaptureStatus): void {
    if (
        !status.active ||
        status.cutoffPhase !== 'active' ||
        status.measurementPhase !== 'measuring' ||
        typeof status.measurementStartedEpochMs !== 'number' ||
        !Number.isFinite(status.measurementStartedEpochMs) ||
        status.measurementStartedEpochMs < status.captureStartedEpochMs ||
        status.invalidReasons.length !== 0 ||
        status.lateDatabaseRequestCount !== 0 ||
        status.lateEventCount !== 0 ||
        status.databaseWorkerCount > 1 ||
        status.playlistRefreshWorkerCount !== 0 ||
        !Number.isSafeInteger(status.captureGeneration) ||
        status.captureGeneration <= 0
    ) {
        invalid();
    }
}

function invalid(): never {
    throw new Error('xtream-main-settlement-invalid');
}
