import type { RendererPerformancePhaseEvent } from '@iptvnator/shared/logging';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import type {
    MainTimelineRecord,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import {
    XTREAM_IPC_PRODUCER_NAMESPACE,
    xtreamIpcProducerNamespaceForWorkerOperation,
} from './xtream-ipc-producer-identity';
import type { XtreamRawIterationResult } from './xtream-summary-contract';
import type {
    XtreamBackgroundProbeEvidence,
    XtreamScenarioTerminalEvidence,
} from './xtream-scenario-driver';
import {
    summarizeXtreamUiActionSamples,
    type XtreamUiActionProbeResult,
    type XtreamUiActionSample,
} from './xtream-ui-action-probe';

const STORE_PREFIX = 'store.';

export function createLegacyTimeline(
    requests: readonly WorkerRequestPerformanceMetrics[]
): MainTimelineRecord[] {
    const legacy = requests.filter(
        (request) =>
            xtreamIpcProducerNamespaceForWorkerOperation(
                request.operation ?? ''
            ) === XTREAM_IPC_PRODUCER_NAMESPACE.LEGACY_PRELOAD
    );
    return legacy.flatMap((request) => {
        const source = requireFixtureValue(request.sourceEpochMs);
        const received = requireFixtureValue(request.requestReceivedEpochMs);
        const response = request.responseEpochMs;
        const completion = response + 0.1;
        const shared = {
            ipcCallId: requireFixtureValue(request.ipcCallId),
            operation: requireFixtureValue(request.operation),
            playlistId: requireFixtureValue(request.playlistId),
        };
        return [
            {
                ...shared,
                epochMs: (source + received) / 2,
                requestId: requireFixtureValue(request.requestId),
                sourceEpochMs: source,
                type: 'db-request',
            },
            {
                ...shared,
                epochMs: response,
                requestId: requireFixtureValue(request.requestId),
                success: true,
                type: 'db-response',
            },
            {
                ...shared,
                epochMs: completion,
                sourceEpochMs: completion,
                success: true,
                type: 'preload-performance-success',
            },
        ];
    });
}

export function createRendererCapture(
    raw: XtreamRawIterationResult,
    background: XtreamUiActionProbeResult | undefined
) {
    const storeEvents = raw.phaseCapture.events.filter(({ phase }) =>
        phase.startsWith(STORE_PREFIX)
    );
    const itemsByPhaseId = new Map(
        storeEvents
            .filter(({ boundary }) => boundary === 'end')
            .map(({ correlationId, itemCount }) => [correlationId, itemCount])
    );
    const performancePhaseEvents = storeEvents.map(
        (event): RendererPerformancePhaseEvent => {
            const itemCount = itemsByPhaseId.get(event.correlationId) ?? null;
            return {
                boundary: event.boundary,
                epochMs: event.epochMs,
                ...(itemCount === null
                    ? {}
                    : { metadata: { items: itemCount } }),
                monotonicMs: event.epochMs,
                ...(event.boundary === 'end' ? { outcome: 'success' } : {}),
                phase: event.phase as RendererPerformancePhaseEvent['phase'],
                phaseId: event.correlationId,
                schemaVersion: 1,
            };
        }
    );
    const probe = {
        cancelEligibleProgressEpochMs:
            raw.cancellation.clickEpochMs === null
                ? null
                : raw.cancellation.clickEpochMs - 0.1,
        cancellationClickEpochMs: raw.cancellation.clickEpochMs,
        dbCancellationTerminalEpochMs:
            raw.cancellation.authoritativeTerminalEpochMs,
        dbOperationEvents: [],
        domReadyEpochMs: raw.phaseCapture.uiPaintEpochMs - 0.1,
        frameGapsMs: [20, 45],
        heartbeatDelaysMs: [5, 12],
        invalidReason: null,
        longTasksMs: [30, 75],
        operationStartEpochMs: raw.phaseCapture.operationStartEpochMs,
        performancePhaseEvents,
        routeReadyEpochMs: raw.phaseCapture.operationStartEpochMs + 0.1,
        scenarioId: raw.scenarioId,
        storeTerminalEpochMs: Math.max(
            ...storeEvents
                .filter(({ boundary }) => boundary === 'end')
                .map(({ epochMs }) => epochMs)
        ),
        terminalEpochMs: raw.phaseCapture.terminalEpochMs,
        uiPaintedEpochMs: raw.phaseCapture.uiPaintEpochMs,
    };
    return {
        captureCutoffEpochMs: raw.phaseCapture.terminalEpochMs + 0.5,
        consoleErrorBreakdown:
            raw.scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT
                ? {
                      databaseSaveCancellation: 1,
                      fetchContentCancellation: 1,
                      initializationCancellation: 1,
                      unexpected: 0,
                  }
                : {
                      databaseSaveCancellation: 0,
                      fetchContentCancellation: 0,
                      initializationCancellation: 0,
                      unexpected: 0,
                  },
        consoleErrorCount:
            raw.scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT ? 3 : 0,
        cpuProfilePath: null,
        frameGap: {
            count: 2,
            max: 45,
            mean: 32.5,
            median: 32.5,
            min: 20,
            p95: 43.75,
            p99: 44.75,
        },
        heapSnapshotPath: null,
        heartbeatDelay: {
            count: 2,
            max: 12,
            mean: 8.5,
            median: 8.5,
            min: 5,
            p95: 11.65,
            p99: 11.93,
        },
        longTask: {
            count: 2,
            max: 75,
            mean: 52.5,
            median: 52.5,
            min: 30,
            p95: 72.75,
            p99: 74.55,
        },
        measurementStartEpochMs: raw.phaseCapture.operationStartEpochMs,
        pageErrorCount: 0,
        peakHeapUsedBytes: raw.renderer.peakHeapUsedBytes,
        postGcHeapUsedBytes: raw.renderer.postGcHeapUsedBytes,
        probe,
        storeToPaintMs:
            raw.phaseCapture.uiPaintEpochMs - probe.storeTerminalEpochMs,
        targetId: raw.renderer.targetId,
        tracePath: null,
        ...(background ? { background } : {}),
    };
}

export function createBackgroundEvidence(
    raw: XtreamRawIterationResult,
    requests: readonly WorkerRequestPerformanceMetrics[]
): XtreamBackgroundProbeEvidence<XtreamUiActionProbeResult> | null {
    if (raw.scenarioId !== XTREAM_SCENARIO_ID.BACKGROUND_UI) return null;
    const request = requireFixtureValue(
        requests.find(
            ({ operation }) => operation === 'DB_DELETE_XTREAM_CONTENT'
        )
    );
    const start = requireFixtureValue(request.workStartedEpochMs);
    const deleteEnd = requireFixtureValue(request.workEndedEpochMs);
    const refreshEnd = Math.max(
        ...raw.phaseCapture.events
            .filter(
                ({ boundary, phase }) =>
                    boundary === 'end' &&
                    phase === 'store.xtream-import-terminal'
            )
            .map(({ epochMs }) => epochMs)
    );
    const step = (refreshEnd - deleteEnd) / 12;
    const categories = [
        'action',
        'navigation',
        'navigation',
        'action',
        'search',
    ] as const;
    const kinds = [
        'type-filter',
        'dashboard',
        'sources',
        'name-a-z',
        'global-search',
    ] as const;
    const samples: XtreamUiActionSample[] = kinds.map((kind, index) => ({
        activeAfter: true,
        activeBefore: true,
        category: requireFixtureValue(categories[index]),
        endEpochMs: deleteEnd + step * (index * 2 + 2),
        kind,
        latencyMs: step,
        startEpochMs: deleteEnd + step * (index * 2 + 1),
    }));
    const summary = summarizeXtreamUiActionSamples(samples);
    return {
        completedEpochMs: requireFixtureValue(samples.at(-1)).endEpochMs,
        operation: 'delete-xtream-content',
        operationId: requireFixtureValue(request.operationId),
        playlistId: requireFixtureValue(request.playlistId),
        result: {
            ...summary,
            dashboardPaintVisibility: 'visible-without-overlay',
            samples,
        },
        startedEpochMs: start,
    };
}

export function createTerminal(
    raw: XtreamRawIterationResult,
    background: XtreamBackgroundProbeEvidence<XtreamUiActionProbeResult> | null
): XtreamScenarioTerminalEvidence {
    const cancellation =
        raw.cancellation.clickEpochMs === null
            ? null
            : {
                  armedEpochMs: raw.phaseCapture.operationStartEpochMs - 0.5,
                  clickEpochMs: raw.cancellation.clickEpochMs,
                  current: 6_000,
                  operationId: requireFixtureValue(
                      raw.cancellation.failedOperationId
                  ),
                  progressEpochMs: raw.cancellation.clickEpochMs - 0.1,
                  threshold: 6_000,
                  total: 60_000,
              };
    const operation =
        background === null
            ? null
            : {
                  active: false,
                  operation: 'delete-xtream-content' as const,
                  operationId: background.operationId,
                  playlistId: background.playlistId,
                  startedEpochMs: background.startedEpochMs - 0.1,
                  terminalEpochMs:
                      requireFixtureValue(background.result.samples[0])
                          .startEpochMs -
                      requireFixtureValue(background.result.samples[0])
                          .latencyMs,
                  terminalStatus: 'completed' as const,
              };
    return {
        backgroundProbe: background,
        cancellation,
        operation,
        scenarioId: raw.scenarioId,
        terminalEpochMs: raw.phaseCapture.terminalEpochMs - 0.1,
    };
}

export function operationOutcomes(
    requests: readonly WorkerRequestPerformanceMetrics[]
) {
    const counts = new Map<string, number>();
    for (const request of requests) {
        const outcome = request.success ? 'success' : 'error';
        const key = `${request.operation}\0${outcome}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].map(([key, count]) => {
        const [operation, outcome] = key.split('\0');
        return {
            count,
            operation: requireFixtureValue(operation),
            outcome: outcome as 'error' | 'success',
        };
    });
}

export function scenarioOrdinal(scenarioId: XtreamScenarioId): number {
    return Object.values(XTREAM_SCENARIO_ID).indexOf(scenarioId) + 1;
}

function requireFixtureValue<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) {
        throw new Error('invalid Xtream assembler fixture');
    }
    return value;
}
