import { isDeepStrictEqual } from 'node:util';

import {
    expectedXtreamWorkerRequestInventory,
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import {
    hasFiniteNonNegativeKeys,
    hasOrderedEventLoopDelay,
    isExactRecord,
    isPositiveSafeInteger,
    isSafeNonNegativeInteger,
    isUtilization,
} from './xtream-exact-schema';
import {
    XTREAM_WORKER_REQUEST_INVALID_REASON,
    XTREAM_WORKER_REQUEST_METRIC_SCOPE,
} from './xtream-summary-contract';
import {
    hasDistinctMonotonicXtreamIpcProducerIdentities,
    xtreamIpcProducerIdentityKey,
    xtreamIpcProducerNamespaceForWorkerOperation,
    type XtreamIpcProducerIdentity,
} from './xtream-ipc-producer-identity';
import { deriveXtreamWorkerRequestWindowProxy } from './xtream-worker-request-proxy';
import { validXtreamWorkerRequestIdentity } from './xtream-worker-request-identity';
import {
    snapshotXtreamWorkerRequestAccounting,
    XTREAM_WORKER_REQUEST_KEYS,
} from './xtream-worker-request-snapshot';
import { normalizeWorkerRequestPerformanceOutcome } from './worker-request-performance';

export function validXtreamWorkerRequestAccounting(
    value: unknown,
    scenarioId: XtreamScenarioId
): boolean {
    const accounting = snapshotXtreamWorkerRequestAccounting(value);
    if (
        accounting === null ||
        !hasFiniteNonNegativeKeys(accounting, [
            'eventLoopDelayMaxMs',
            'eventLoopDelayP95Ms',
            'eventLoopDelayP99Ms',
            'eventLoopUtilization',
        ]) ||
        !hasOrderedEventLoopDelay(accounting) ||
        !isUtilization(accounting['eventLoopUtilization']) ||
        !isPositiveSafeInteger(accounting['totalCount']) ||
        !isPositiveSafeInteger(accounting['validSampleCount']) ||
        !isSafeNonNegativeInteger(accounting['invalidSampleCount']) ||
        accounting['metricScope'] !==
            XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY
    ) {
        return false;
    }

    const evidence = accounting[
        'evidence'
    ] as readonly WorkerRequestPerformanceMetrics[];
    const invalidReasons = accounting['invalidReasons'] as readonly unknown[];
    if (
        evidence.length !== accounting['totalCount'] ||
        evidence.some((request) => !isCanonicalRequest(request)) ||
        !hasDistinctRequestIdentities(evidence) ||
        !hasMonotonicProducerChronology(evidence) ||
        !hasExpectedInventory(evidence, scenarioId) ||
        !hasExpectedItemCounts(evidence, scenarioId) ||
        !hasExpectedDeleteIdentities(evidence, scenarioId)
    ) {
        return false;
    }
    const invalidSampleCount = evidence.filter(
        (request) =>
            request.invalidReason ===
            XTREAM_WORKER_REQUEST_INVALID_REASON.OVERLAPPING_DATABASE_REQUESTS
    ).length;
    if (
        invalidSampleCount !== accounting['invalidSampleCount'] ||
        evidence.length - invalidSampleCount !==
            accounting['validSampleCount'] ||
        (scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE &&
            invalidSampleCount > 0)
    ) {
        return false;
    }
    const proxy = deriveXtreamWorkerRequestWindowProxy(evidence);
    return (
        proxy !== null &&
        proxy.eventLoopDelayMaxMs === accounting['eventLoopDelayMaxMs'] &&
        proxy.eventLoopDelayP95Ms === accounting['eventLoopDelayP95Ms'] &&
        proxy.eventLoopDelayP99Ms === accounting['eventLoopDelayP99Ms'] &&
        proxy.eventLoopUtilization === accounting['eventLoopUtilization'] &&
        hasExactInvalidReasons(invalidReasons, invalidSampleCount)
    );
}

function isCanonicalRequest(
    value: unknown
): value is WorkerRequestPerformanceMetrics {
    if (
        !isExactRecord(value, XTREAM_WORKER_REQUEST_KEYS) ||
        typeof value['operation'] !== 'string' ||
        !value['operation'].startsWith('DB_') ||
        typeof value['requestId'] !== 'string' ||
        value['requestId'].length === 0 ||
        typeof value['success'] !== 'boolean' ||
        value['performanceCaptureUnavailableReason'] !== null ||
        !validNullableIdentifier(value['playlistId']) ||
        !validXtreamWorkerRequestIdentity(value)
    ) {
        return false;
    }
    const normalized = normalizeWorkerRequestPerformanceOutcome({
        ipcCallId: value['ipcCallId'] as number | null,
        operation: value['operation'],
        operationId: value['operationId'] as string | null,
        operationIdUnavailableReason: value['operationIdUnavailableReason'] as
            string | null,
        performanceCapture: {
            eventLoopDelay: value['eventLoopDelay'],
            eventLoopDelayUnavailableReason:
                value['eventLoopDelayUnavailableReason'],
            eventLoopUtilization: value['eventLoopUtilization'],
            eventLoopUtilizationUnavailableReason:
                value['eventLoopUtilizationUnavailableReason'],
            histogramFlushedEpochMs: value['histogramFlushedEpochMs'],
            invalidReason: value['invalidReason'],
            phaseEvents: value['phaseEvents'],
            requestReceivedEpochMs: value['requestReceivedEpochMs'],
            responsePostedEpochMs: value['responsePostedEpochMs'],
            threadCpuSystemMicros: value['threadCpuSystemMicros'],
            threadCpuUnavailableReason: value['threadCpuUnavailableReason'],
            threadCpuUserMicros: value['threadCpuUserMicros'],
            workEndedEpochMs: value['workEndedEpochMs'],
            workStartedEpochMs: value['workStartedEpochMs'],
        },
        playlistId: value['playlistId'] as string | null,
        requestId: value['requestId'],
        responseEpochMs: value['responseEpochMs'] as number,
        sourceEpochMs: value['sourceEpochMs'] as number | null,
        success: value['success'],
    });
    return (
        normalized.performanceCaptureUnavailableReason === null &&
        isDeepStrictEqual(normalized, value)
    );
}

function hasDistinctRequestIdentities(
    evidence: readonly WorkerRequestPerformanceMetrics[]
): boolean {
    const requestIds = evidence.map(({ requestId }) => requestId);
    const producerIdentities = collectProducerIdentities(evidence);
    if (producerIdentities === null) return false;
    const ipcCallIds = producerIdentities.map(({ ipcCallId, namespace }) =>
        xtreamIpcProducerIdentityKey(namespace, ipcCallId)
    );
    const operationIds = evidence.flatMap(({ operationId }) =>
        operationId === null ? [] : [operationId]
    );
    return (
        new Set(requestIds).size === requestIds.length &&
        new Set(ipcCallIds).size === ipcCallIds.length &&
        new Set(operationIds).size === operationIds.length
    );
}

function hasMonotonicProducerChronology(
    evidence: readonly WorkerRequestPerformanceMetrics[]
): boolean {
    // Evidence is only a subset of preload calls, so ID gaps are valid. The
    // producer clamps its clock, which also makes equal source epochs valid.
    const identities = collectProducerIdentities(evidence);
    return (
        identities !== null &&
        hasDistinctMonotonicXtreamIpcProducerIdentities(identities)
    );
}

function collectProducerIdentities(
    evidence: readonly WorkerRequestPerformanceMetrics[]
): readonly XtreamIpcProducerIdentity[] | null {
    const identities: XtreamIpcProducerIdentity[] = [];
    for (const { ipcCallId, operation, sourceEpochMs } of evidence) {
        if (ipcCallId === null && sourceEpochMs === null) continue;
        const namespace = xtreamIpcProducerNamespaceForWorkerOperation(
            typeof operation === 'string' ? operation : ''
        );
        if (
            namespace === null ||
            !isPositiveSafeInteger(ipcCallId) ||
            typeof sourceEpochMs !== 'number'
        ) {
            return null;
        }
        identities.push({ ipcCallId, namespace, sourceEpochMs });
    }
    return identities;
}

function hasExpectedInventory(
    evidence: readonly WorkerRequestPerformanceMetrics[],
    scenarioId: XtreamScenarioId
): boolean {
    const expected = new Map<string, number>();
    for (const entry of expectedXtreamWorkerRequestInventory(scenarioId)) {
        expected.set(signature(entry), entry.count);
    }
    const actual = new Map<string, number>();
    for (const request of evidence) {
        const phases = request.phaseEvents
            .filter(({ boundary }) => boundary === 'end')
            .map(({ phase }) => phase);
        const key = signature({
            operation: request.operation ?? '',
            phases,
            success: request.success,
        });
        actual.set(key, (actual.get(key) ?? 0) + 1);
    }
    return isDeepStrictEqual(actual, expected);
}

function hasExpectedItemCounts(
    evidence: readonly WorkerRequestPerformanceMetrics[],
    scenarioId: XtreamScenarioId
): boolean {
    const operations = new Set(
        expectedXtreamWorkerRequestInventory(scenarioId).map(
            ({ operation }) => operation
        )
    );
    for (const operation of operations) {
        const actual = evidence
            .filter((request) => request.operation === operation)
            .map(requestItemCounts);
        const expected = expectedItemCounts(scenarioId, operation);
        if (expected === null) continue;
        if (operation === 'DB_CLEAR_XTREAM_IMPORT_CACHE') {
            const values = actual.flat();
            if (
                values.length !== 3 ||
                values.filter((value) => value === 20).length !== 2 ||
                values.filter(
                    (value) =>
                        typeof value === 'number' &&
                        value >= 6_060 &&
                        value < 60_060
                ).length !== 1
            ) {
                return false;
            }
            continue;
        }
        if (!isDeepStrictEqual(sorted(actual), sorted(expected))) return false;
    }
    return true;
}

function expectedItemCounts(
    scenarioId: XtreamScenarioId,
    operation: string
): readonly (readonly (number | null)[])[] | null {
    if (operation === 'DB_UPSERT_APP_PLAYLIST') return [[null, 1]];
    if (operation === 'DB_GET_APP_PLAYLIST') return [[1, 0]];
    if (operation === 'DB_GET_CATEGORIES') {
        const importReads = [[0], [0], [0], [60], [20], [20]] as const;
        return scenarioId === XTREAM_SCENARIO_ID.REFRESH_LARGE ||
            scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI
            ? [...importReads, [60], [20], [20]]
            : importReads;
    }
    if (operation === 'DB_SAVE_CATEGORIES') {
        return [
            [60, 60],
            [20, 20],
            [20, 20],
        ];
    }
    if (operation === 'DB_GET_CONTENT') {
        if (scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT) return [[0]];
        const importReads = [
            [0],
            [60_000],
            [0],
            [20_000],
            [0],
            [20_000],
        ] as const;
        return scenarioId === XTREAM_SCENARIO_ID.REFRESH_LARGE ||
            scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI
            ? [...importReads, [60_000], [20_000], [20_000]]
            : importReads;
    }
    if (operation === 'DB_SAVE_CONTENT') {
        return scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT
            ? [[60, 60_000, null]]
            : [
                  [60, 60_000, 60_000],
                  [20, 20_000, 20_000],
                  [20, 20_000, 20_000],
              ];
    }
    if (operation === 'DB_DELETE_XTREAM_CONTENT') {
        return [[100_100, 100_100]];
    }
    if (operation === 'DB_DELETE_PLAYLIST') {
        return [
            [100_100, 100_101],
            [0, 1],
        ];
    }
    if (operation === 'DB_CLEAR_XTREAM_IMPORT_CACHE') return [[], [], []];
    return null;
}

function hasExpectedDeleteIdentities(
    evidence: readonly WorkerRequestPerformanceMetrics[],
    scenarioId: XtreamScenarioId
): boolean {
    if (scenarioId !== XTREAM_SCENARIO_ID.DELETE_LARGE) return true;
    const deletes = evidence.filter(
        ({ operation }) => operation === 'DB_DELETE_PLAYLIST'
    );
    const populated = deletes.find((request) =>
        isDeepStrictEqual(requestItemCounts(request), [100_100, 100_101])
    );
    const emptyFollowUp = deletes.find((request) =>
        isDeepStrictEqual(requestItemCounts(request), [0, 1])
    );
    return (
        deletes.length === 2 &&
        typeof populated?.operationId === 'string' &&
        populated.operationId.length > 0 &&
        populated.operationIdUnavailableReason === null &&
        emptyFollowUp?.operationId === null &&
        emptyFollowUp.operationIdUnavailableReason === null
    );
}

function requestItemCounts(
    request: WorkerRequestPerformanceMetrics
): readonly (number | null)[] {
    return request.phaseEvents
        .filter(({ boundary }) => boundary === 'end')
        .map(({ metadata }) => metadata?.itemCount ?? null);
}

function hasExactInvalidReasons(
    value: readonly unknown[],
    invalidSampleCount: number
): boolean {
    if (invalidSampleCount === 0) return value.length === 0;
    const reason = value[0];
    return (
        value.length === 1 &&
        isExactRecord(reason, ['count', 'reason']) &&
        reason['count'] === invalidSampleCount &&
        reason['reason'] ===
            XTREAM_WORKER_REQUEST_INVALID_REASON.OVERLAPPING_DATABASE_REQUESTS
    );
}

function signature(value: {
    readonly operation: string;
    readonly phases: readonly string[];
    readonly success: boolean;
}): string {
    return `${value.operation}\0${value.success ? 'success' : 'error'}\0${value.phases.join('\0')}`;
}

function sorted(
    values: readonly (readonly (number | null)[])[]
): readonly string[] {
    return values.map((value) => JSON.stringify(value)).sort();
}

function validNullableIdentifier(value: unknown): boolean {
    return value === null || (typeof value === 'string' && value.length > 0);
}
