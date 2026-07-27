import type {
    DatabaseWorkerPerformancePhase,
    PerformancePhaseEvent,
} from '@iptvnator/shared/interfaces';

import {
    expectedXtreamWorkerRequestInventory,
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import {
    XTREAM_WORKER_REQUEST_IDENTITY_KIND,
    xtreamWorkerRequestIdentityKind,
} from './xtream-worker-request-identity';
import { normalizeWorkerRequestPerformanceOutcome } from './worker-request-performance';

export function workerRequestEvidence(
    scenarioId: XtreamScenarioId
): WorkerRequestPerformanceMetrics[] {
    let requestOrdinal = 0;
    const operationOrdinals = new Map<string, number>();
    return expectedXtreamWorkerRequestInventory(scenarioId).flatMap((entry) =>
        Array.from({ length: entry.count }, () => {
            requestOrdinal += 1;
            const operationOrdinal =
                (operationOrdinals.get(entry.operation) ?? 0) + 1;
            operationOrdinals.set(entry.operation, operationOrdinal);
            return request(
                scenarioId,
                entry.operation,
                entry.phases,
                entry.success,
                operationOrdinal,
                requestOrdinal
            );
        })
    );
}

export function invalidateWorkerRequestMetrics(
    requests: readonly WorkerRequestPerformanceMetrics[],
    count: number
): WorkerRequestPerformanceMetrics[] {
    return requests.map((request, index) =>
        index >= count
            ? request
            : {
                  ...request,
                  eventLoopDelay: null,
                  eventLoopDelayUnavailableReason:
                      'overlapping-database-worker-requests',
                  eventLoopUtilization: null,
                  eventLoopUtilizationUnavailableReason:
                      'overlapping-database-worker-requests',
                  histogramFlushedEpochMs: null,
                  invalidReason: 'overlapping-database-worker-requests',
                  threadCpuSystemMicros: null,
                  threadCpuUnavailableReason:
                      'overlapping-database-worker-requests',
                  threadCpuUserMicros: null,
              }
    );
}

function request(
    scenarioId: XtreamScenarioId,
    operation: string,
    phases: readonly string[],
    success: boolean,
    operationOrdinal: number,
    requestOrdinal: number
): WorkerRequestPerformanceMetrics {
    const requestId = `request-${requestOrdinal}`;
    const start = 1_000 + requestOrdinal * 20;
    const phaseEvents = createPhaseEvents(
        phases,
        phaseItemCounts(scenarioId, operation, operationOrdinal),
        requestId,
        start + 2,
        success
    );
    const identity = requestIdentity(
        scenarioId,
        operation,
        operationOrdinal,
        requestOrdinal,
        start
    );
    return normalizeWorkerRequestPerformanceOutcome({
        ...identity,
        operation,
        performanceCapture: {
            eventLoopDelay: { maxMs: 9, p95Ms: 3, p99Ms: 5 },
            eventLoopDelayUnavailableReason: null,
            eventLoopUtilization: 0.5,
            eventLoopUtilizationUnavailableReason: null,
            histogramFlushedEpochMs: start + 13,
            invalidReason: null,
            phaseEvents,
            requestReceivedEpochMs: start,
            responsePostedEpochMs: start + 14,
            threadCpuSystemMicros: 10,
            threadCpuUnavailableReason: null,
            threadCpuUserMicros: 20,
            workEndedEpochMs: start + 12,
            workStartedEpochMs: start + 1,
        },
        playlistId: 'synthetic-playlist',
        requestId,
        responseEpochMs: start + 15,
        success,
    });
}

function requestIdentity(
    scenarioId: XtreamScenarioId,
    operation: string,
    operationOrdinal: number,
    requestOrdinal: number,
    start: number
) {
    const kind = xtreamWorkerRequestIdentityKind(operation);
    if (kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.NOT_APPLICABLE) {
        return {
            ipcCallId: null,
            operationId: null,
            operationIdUnavailableReason:
                'preload-performance-marker-not-applicable',
            sourceEpochMs: null,
        } as const;
    }
    const correlatedLegacy =
        kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.LEGACY_PRELOAD &&
        (scenarioId === XTREAM_SCENARIO_ID.REFRESH_LARGE ||
            scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI) &&
        (operation === 'DB_UPSERT_APP_PLAYLIST' || operationOrdinal === 1);
    const emptyDeleteFollowUp =
        operation === 'DB_DELETE_PLAYLIST' && operationOrdinal === 2;
    const operationId =
        (kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.PRODUCER_OPERATION ||
            correlatedLegacy) &&
        !emptyDeleteFollowUp
            ? `operation-${requestOrdinal}`
            : null;
    return {
        ipcCallId: requestOrdinal,
        operationId,
        operationIdUnavailableReason:
            kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.LEGACY_PRELOAD &&
            !correlatedLegacy
                ? 'preload-performance-marker-uncorrelated'
                : null,
        sourceEpochMs: start - 1,
    } as const;
}

function createPhaseEvents(
    phases: readonly string[],
    itemCounts: readonly (number | null)[],
    requestId: string,
    firstEpochMs: number,
    success: boolean
): PerformancePhaseEvent<DatabaseWorkerPerformancePhase>[] {
    return phases.flatMap((phase, index) => {
        const startEpochMs = firstEpochMs + index * 2;
        const itemCount = itemCounts[index] ?? null;
        const omitCancelledWriteCount = !success && index === phases.length - 1;
        return [
            {
                boundary: 'start' as const,
                durationMs: null,
                epochMs: startEpochMs,
                phase: phase as DatabaseWorkerPerformancePhase,
                requestId,
            },
            {
                boundary: 'end' as const,
                durationMs: 1,
                epochMs: startEpochMs + 1,
                ...(!omitCancelledWriteCount && itemCount !== null
                    ? { metadata: { itemCount } }
                    : {}),
                phase: phase as DatabaseWorkerPerformancePhase,
                requestId,
            },
        ];
    });
}

function phaseItemCounts(
    scenarioId: XtreamScenarioId,
    operation: string,
    ordinal: number
): readonly (number | null)[] {
    if (operation === 'DB_UPSERT_APP_PLAYLIST') return [null, 1];
    if (operation === 'DB_GET_APP_PLAYLIST') return [1, 0];
    if (operation === 'DB_DELETE_XTREAM_CONTENT') return [100_100, 100_100];
    if (operation === 'DB_DELETE_PLAYLIST') {
        return ordinal === 1 ? [100_100, 100_101] : [0, 1];
    }
    if (operation === 'DB_GET_CATEGORIES') {
        return [[0], [60], [0], [20], [0], [20]][ordinal - 1] ?? [];
    }
    if (operation === 'DB_SAVE_CATEGORIES') {
        const count = [60, 20, 20][ordinal - 1] ?? 0;
        return [count, count];
    }
    if (operation === 'DB_GET_CONTENT') {
        if (scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT) return [0];
        return [[0], [60_000], [0], [20_000], [0], [20_000]][ordinal - 1] ?? [];
    }
    if (operation === 'DB_SAVE_CONTENT') {
        if (scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT) {
            return [60, 60_000, null];
        }
        const index = ordinal - 1;
        return (
            [
                [60, 60_000, 60_000],
                [20, 20_000, 20_000],
                [20, 20_000, 20_000],
            ][index] ?? []
        );
    }
    if (operation === 'DB_CLEAR_XTREAM_IMPORT_CACHE') {
        return [ordinal === 1 ? 6_060 : 20];
    }
    return [];
}
