import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import type {
    XtreamMainCaptureResult,
    XtreamMainCaptureOperationOutcome,
} from './m3u-refresh-main-capture';
import {
    XTREAM_ITERATION_KIND,
    type XtreamIterationKind,
} from './xtream-benchmark-contract';
import type { XtreamDiagnosticArtifactEvidence } from './xtream-diagnostic-evidence';
import type { XtreamRendererCaptureMetrics } from './xtream-renderer-capture';
import {
    XTREAM_NOT_APPLICABLE,
    XTREAM_MAIN_CPU_METRIC_SCOPE,
    XTREAM_WORKER_CPU_METRIC_SCOPE,
    XTREAM_WORKER_REQUEST_INVALID_REASON,
    XTREAM_WORKER_REQUEST_METRIC_SCOPE,
    XTREAM_WORKER_WHOLE_METRIC_SCOPE,
    type XtreamDatabaseWorkerMetrics,
    type XtreamMainMetrics,
    type XtreamRendererMetrics,
    type XtreamWorkerRequestAccounting,
} from './xtream-summary-contract';
import { deriveXtreamWorkerRequestWindowProxy } from './xtream-worker-request-proxy';

interface MetricContext {
    readonly diagnostic: XtreamDiagnosticArtifactEvidence | null;
    readonly kind: XtreamIterationKind;
}

export function createXtreamMainMetrics(
    main: XtreamMainCaptureResult,
    context: MetricContext
): XtreamMainMetrics {
    const memory = main.capture.memory;
    const window = main.capture.rendererWindow;
    return {
        ...profile(context, 'main'),
        browserWindowId: window.windowIdentity.browserWindowId,
        cpuMetricScope: XTREAM_MAIN_CPU_METRIC_SCOPE.ELECTRON_MAIN_THREAD,
        cpuSystemMicros: main.capture.cpuSystemMicros,
        cpuUserMicros: main.capture.cpuUserMicros,
        eventLoopDelayMaxMs: main.capture.eventLoopDelay.maxMs,
        eventLoopDelayP95Ms: main.capture.eventLoopDelay.p95Ms,
        eventLoopDelayP99Ms: main.capture.eventLoopDelay.p99Ms,
        eventLoopUtilization: null,
        eventLoopUtilizationUnavailableReason:
            XTREAM_NOT_APPLICABLE.MAIN_EVENT_LOOP_UTILIZATION,
        peakHeapUsedBytes: memory.peakHeapUsedBytes,
        peakRssBytes: memory.peakRssBytes,
        postGcHeapUsedBytes: requireNumber(memory.postGcHeapUsedBytes),
        responsiveEvents: window.responsiveEvents,
        unresponsiveEvents: window.unresponsiveEvents,
        webContentsId: window.windowIdentity.webContentsId,
    };
}

export function createXtreamRendererMetrics(
    main: XtreamMainCaptureResult,
    renderer: XtreamRendererCaptureMetrics,
    context: MetricContext,
    background: {
        readonly actionLatencyMs: number;
        readonly dashboardPaintVisibility: 'visible-without-overlay';
        readonly navigationLatencyMs: number;
        readonly searchLatencyMs: number;
    } | null
): XtreamRendererMetrics {
    const rss = main.capture.rendererWindow.rss;
    if (
        rss.unavailableReason !== null ||
        rss.missingSampleCount !== 0 ||
        rss.validSampleCount <= 0
    ) {
        invalid();
    }
    return {
        ...profile(context, 'renderer'),
        actionLatencyMs: background?.actionLatencyMs ?? null,
        consoleErrors: [],
        dashboardPaintVisibility: background?.dashboardPaintVisibility ?? null,
        frameGapMaxMs: requireDistribution(renderer.frameGap, 'max', true),
        frameGapP95Ms: requireDistribution(renderer.frameGap, 'p95', true),
        heartbeatMaxMs: requireDistribution(
            renderer.heartbeatDelay,
            'max',
            true
        ),
        heartbeatP95Ms: requireDistribution(
            renderer.heartbeatDelay,
            'p95',
            true
        ),
        longTaskCount: renderer.longTask.count,
        longTaskMaxMs:
            renderer.longTask.count === 0
                ? 0
                : requireDistribution(renderer.longTask, 'max', true),
        navigationLatencyMs: background?.navigationLatencyMs ?? null,
        peakHeapUsedBytes: renderer.peakHeapUsedBytes,
        peakRssBytes: requireNumber(rss.peakRssBytes),
        postGcHeapUsedBytes: renderer.postGcHeapUsedBytes,
        searchLatencyMs: background?.searchLatencyMs ?? null,
        storeToPaintMs: renderer.storeToPaintMs,
        targetId: renderer.targetId,
    };
}

export function createXtreamDatabaseWorkerMetrics(
    main: XtreamMainCaptureResult,
    context: MetricContext
): XtreamDatabaseWorkerMetrics {
    const worker = main.workers[0];
    if (
        main.workers.length !== 1 ||
        !worker ||
        worker.kind !== 'database.worker' ||
        worker.heapUsedSampleCount <= 0 ||
        worker.externalMemorySampleCount <= 0 ||
        worker.peakHeapUsedUnavailableReason !== null ||
        worker.peakExternalUnavailableReason !== null ||
        worker.postGcHeapUnavailableReason !== null
    ) {
        invalid();
    }
    const requests = createRequestAccounting(worker.requests);
    const threadCpu = sumXtreamRequestThreadCpu(requests.evidence);
    if (
        context.diagnostic &&
        context.diagnostic.profiles.databaseWorker.ordinal !== worker.ordinal
    ) {
        invalid();
    }
    return {
        ...profile(context, 'databaseWorker'),
        cpuMetricScope: XTREAM_WORKER_CPU_METRIC_SCOPE.SUM_VALID_REQUEST_WORK,
        cpuSystemMicros: threadCpu.system,
        cpuUserMicros: threadCpu.user,
        currentForCapture: true,
        eventLoopDelayMaxMs: requests.eventLoopDelayMaxMs,
        eventLoopDelayMetricScope:
            XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY,
        eventLoopDelayP95Ms: requests.eventLoopDelayP95Ms,
        eventLoopDelayP99Ms: requests.eventLoopDelayP99Ms,
        eventLoopUtilization: requireNumber(worker.eventLoopUtilization),
        kind: 'database.worker',
        ordinal: worker.ordinal,
        peakExternalBytes: requireNumber(worker.peakExternalBytes),
        peakHeapUsedBytes: requireNumber(worker.peakHeapUsedBytes),
        postGcHeapUsedBytes: requireNumber(worker.postGcHeapUsedBytes),
        requests,
        rssBytes: null,
        rssUnavailableReason: XTREAM_NOT_APPLICABLE.DATABASE_WORKER_RSS,
        wholeWorkerMetricScope:
            XTREAM_WORKER_WHOLE_METRIC_SCOPE.OPERATION_WINDOW,
    };
}

function sumXtreamRequestThreadCpu(
    requests: readonly WorkerRequestPerformanceMetrics[]
): { readonly system: number; readonly user: number } {
    let system = 0;
    let user = 0;
    for (const request of requests) {
        if (
            request.invalidReason ===
            XTREAM_WORKER_REQUEST_INVALID_REASON.OVERLAPPING_DATABASE_REQUESTS
        ) {
            continue;
        }
        if (
            request.invalidReason !== null ||
            request.threadCpuUnavailableReason !== null ||
            request.threadCpuSystemMicros === null ||
            request.threadCpuUserMicros === null
        ) {
            invalid();
        }
        system += request.threadCpuSystemMicros;
        user += request.threadCpuUserMicros;
    }
    if (
        !Number.isSafeInteger(system) ||
        system < 0 ||
        !Number.isSafeInteger(user) ||
        user < 0
    ) {
        invalid();
    }
    return Object.freeze({ system, user });
}

export function assertXtreamMainEvidenceGates(
    main: XtreamMainCaptureResult
): void {
    if (
        main.databaseWorkerCount !== 1 ||
        main.playlistRefreshWorkerCount !== 0 ||
        main.workers.length !== 1 ||
        main.workers[0]?.kind !== 'database.worker' ||
        main.lateDatabaseRequestCount !== 0 ||
        main.lateEventCount !== 0 ||
        main.quarantinedIpcMarkerCount !== 0 ||
        main.rollover !== null ||
        Object.values(main.invalidReasons).some(
            (reasons) => reasons.length !== 0
        ) ||
        main.capture.workers.length !== main.workers.length ||
        main.capture.workers[0]?.ordinal !== main.workers[0]?.ordinal ||
        main.requests.length !== main.workers[0]?.requests.length ||
        !sameOutcomes(main.operationOutcomes, main.requests)
    ) {
        invalid();
    }
}

function createRequestAccounting(
    evidence: readonly WorkerRequestPerformanceMetrics[]
): XtreamWorkerRequestAccounting {
    const snapshot = evidence.map(cloneRequest);
    const proxy = deriveXtreamWorkerRequestWindowProxy(snapshot);
    if (!proxy) invalid();
    const invalidSampleCount = snapshot.filter(
        ({ invalidReason }) =>
            invalidReason ===
            XTREAM_WORKER_REQUEST_INVALID_REASON.OVERLAPPING_DATABASE_REQUESTS
    ).length;
    return {
        evidence: Object.freeze(snapshot),
        ...proxy,
        invalidReasons:
            invalidSampleCount === 0
                ? []
                : [
                      {
                          count: invalidSampleCount,
                          reason: XTREAM_WORKER_REQUEST_INVALID_REASON.OVERLAPPING_DATABASE_REQUESTS,
                      },
                  ],
        invalidSampleCount,
        metricScope:
            XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY,
        totalCount: snapshot.length,
        validSampleCount: snapshot.length - invalidSampleCount,
    };
}

function cloneRequest(
    request: WorkerRequestPerformanceMetrics
): WorkerRequestPerformanceMetrics {
    return {
        ...request,
        eventLoopDelay:
            request.eventLoopDelay === null
                ? null
                : { ...request.eventLoopDelay },
        phaseEvents: request.phaseEvents.map((event) => ({
            ...event,
            ...(event.metadata ? { metadata: { ...event.metadata } } : {}),
        })),
    };
}

function sameOutcomes(
    actual: readonly XtreamMainCaptureOperationOutcome[],
    requests: readonly WorkerRequestPerformanceMetrics[]
): boolean {
    const expected = new Map<string, number>();
    for (const request of requests) {
        const key = `${request.operation}\0${
            request.success ? 'success' : 'error'
        }`;
        expected.set(key, (expected.get(key) ?? 0) + 1);
    }
    const observed = new Map(
        actual.map(({ count, operation, outcome }) => [
            `${operation}\0${outcome}`,
            count,
        ])
    );
    return (
        actual.every(({ outcome }) => outcome !== 'pending') &&
        expected.size === observed.size &&
        [...expected].every(([key, count]) => observed.get(key) === count)
    );
}

function profile(
    context: MetricContext,
    process: 'databaseWorker' | 'main' | 'renderer'
) {
    if (context.kind !== XTREAM_ITERATION_KIND.DIAGNOSTIC) {
        if (context.diagnostic !== null) invalid();
        return {
            cpuProfileDurationMicros: null,
            cpuProfileUnavailableReason:
                XTREAM_NOT_APPLICABLE.PROFILE_OUTSIDE_DIAGNOSTIC,
        } as const;
    }
    if (!context.diagnostic) invalid();
    const duration =
        process === 'databaseWorker'
            ? context.diagnostic.profiles.databaseWorker.durationMicros
            : context.diagnostic.profiles[process].durationMicros;
    return {
        cpuProfileDurationMicros: duration,
        cpuProfileUnavailableReason: null,
    } as const;
}

function requireDistribution(
    value: {
        readonly count: number;
        readonly max: number | null;
        readonly p95: number | null;
    },
    key: 'max' | 'p95',
    requireSamples: boolean
): number {
    if (requireSamples && value.count <= 0) invalid();
    return requireNumber(value[key]);
}

function requireNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        invalid();
    return value;
}

function invalid(): never {
    throw new Error('invalid Xtream assembly metrics evidence');
}
