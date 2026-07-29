import {
    XTREAM_ITERATION_KIND,
    type XtreamIterationDefinition,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { iteration } from './xtream-benchmark-report.fixtures';
import type {
    WorkerCaptureMetrics,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import type {
    XtreamIpcAttributionSpan,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import { XTREAM_ATTRIBUTION_PHASE as PHASE } from './xtream-phase-inventory';
import {
    XTREAM_IPC_PRODUCER_NAMESPACE,
    xtreamIpcProducerNamespaceForMethod,
    xtreamIpcProducerNamespaceForWorkerOperation,
} from './xtream-ipc-producer-identity';
import type { XtreamIterationAssemblyInput } from './xtream-iteration-assembler';
import {
    createBackgroundEvidence,
    createLegacyTimeline,
    createRendererCapture,
    createTerminal,
    operationOutcomes,
    scenarioOrdinal,
} from './xtream-iteration-assembler-fixture-runtime';
import type { XtreamIpcTimelineRecord } from './xtream-ipc-marker-events.model';
import type { XtreamRawIterationResult } from './xtream-summary-contract';

const MAIN_PHASES = new Set<string>([
    PHASE.CANCEL_SESSION,
    PHASE.JSON_TRANSFORM,
    PHASE.NETWORK_TOTAL,
    PHASE.RESPONSE_READY,
]);

export function createXtreamAssemblerFixture(
    scenarioId: XtreamScenarioId
): XtreamIterationAssemblyInput {
    const definition: XtreamIterationDefinition = {
        eligibleForComparison: true,
        kind: XTREAM_ITERATION_KIND.MEASURED,
        runId: 'run-01',
        scenarioId,
    };
    const raw = iteration(definition, scenarioOrdinal(scenarioId));
    const worker = createWorker(raw);
    const background = createBackgroundEvidence(raw, worker.requests);
    const captureStartedEpochMs = raw.phaseCapture.operationStartEpochMs - 1;
    const captureCutoffEpochMs = raw.phaseCapture.terminalEpochMs + 1;
    const rendererCapture = createRendererCapture(raw, background?.result);
    return {
        catalogVerification: {
            databaseStateValid: true,
            fixtureIdentityValid: true,
            providerCategoryCount:
                raw.catalogVerification.providerCategoryCount,
            providerItemCount: raw.catalogVerification.providerItemCount,
            verifiedAfterCapture: true,
        },
        definition,
        diagnosticArtifacts: null,
        mainCapture: {
            cancelTimeline:
                raw.cancellationEvidence?.timeline.map((entry) => ({
                    ...entry,
                })) ?? [],
            capture: {
                cpuProfilePath: null,
                cpuSystemMicros: raw.main.cpuSystemMicros,
                cpuUserMicros: raw.main.cpuUserMicros,
                eventLoopDelay: {
                    maxMs: raw.main.eventLoopDelayMaxMs,
                    p95Ms: raw.main.eventLoopDelayP95Ms,
                    p99Ms: raw.main.eventLoopDelayP99Ms,
                },
                eventLoopUtilization: null,
                eventLoopUtilizationUnavailableReason:
                    raw.main.eventLoopUtilizationUnavailableReason,
                heapSnapshotPath: null,
                memory: {
                    peakHeapUsedBytes: raw.main.peakHeapUsedBytes,
                    peakRssBytes: raw.main.peakRssBytes,
                    postGcHeapUsedBytes: raw.main.postGcHeapUsedBytes,
                    postGcRssBytes: raw.main.peakRssBytes - 1,
                },
                rendererWindow: {
                    responsiveEvents: raw.main.responsiveEvents,
                    rss: {
                        identity: { creationTime: 1, pid: 42 },
                        missingSampleCount: 0,
                        peakRssBytes: raw.renderer.peakRssBytes,
                        unavailableReason: null,
                        validSampleCount: 2,
                    },
                    unresponsiveEvents: raw.main.unresponsiveEvents,
                    windowIdentity: {
                        browserWindowId: raw.main.browserWindowId,
                        webContentsId: raw.main.webContentsId,
                    },
                },
                rssScope:
                    'electron-main-process-including-worker-threads-and-native-memory',
                timeline: createLegacyTimeline(worker.requests),
                workers: [worker],
            },
            captureCutoffEpochMs,
            captureGeneration: 1,
            captureStartedEpochMs,
            captureStoppedEpochMs: captureCutoffEpochMs + 1,
            databaseWorkerCount: 1,
            invalidReasons: {
                capture: [],
                databaseWorkerCancel: [],
                xtreamIpc: [],
            },
            ipcTimeline: createXtreamTimeline(raw),
            lateDatabaseRequestCount: 0,
            lateEventCount: 0,
            measurementStartedEpochMs:
                raw.phaseCapture.operationStartEpochMs - 0.5,
            operationOutcomes: operationOutcomes(worker.requests),
            playlistRefreshWorkerCount: 0,
            quarantinedIpcMarkerCount: 0,
            requests: worker.requests,
            rollover: null,
            workers: [worker],
        },
        process: {
            electronPid: 20_000 + scenarioOrdinal(scenarioId),
            freshProcessVerified: true,
            launchId: `launch-${scenarioOrdinal(scenarioId)}`,
            profileDirectorySha256: String(scenarioOrdinal(scenarioId)).repeat(
                64
            ),
            startupAttemptCount: 1,
            startupRetryReasons: [],
        },
        rendererCapture,
        terminal: createTerminal(raw, background),
        trigger: {
            scenarioId,
            triggerEpochMs: raw.phaseCapture.operationStartEpochMs + 0.1,
        },
    };
}

function createWorker(raw: XtreamRawIterationResult): WorkerCaptureMetrics {
    const metric = raw.databaseWorker;
    return {
        cancelPostedEpochMs: raw.cancellation.databaseDispatchEpochMs,
        cpuSystemMicros: metric.cpuSystemMicros,
        cpuUserMicros: metric.cpuUserMicros,
        eventLoopDelay: {
            maxMs: metric.eventLoopDelayMaxMs,
            p95Ms: metric.eventLoopDelayP95Ms,
            p99Ms: metric.eventLoopDelayP99Ms,
        },
        eventLoopDelayUnavailableReason: null,
        eventLoopUtilization: metric.eventLoopUtilization,
        externalMemorySampleCount: 2,
        heapUsedSampleCount: 2,
        kind: 'database.worker',
        operationId: null,
        ordinal: metric.ordinal,
        peakExternalBytes: metric.peakExternalBytes,
        peakExternalUnavailableReason: null,
        peakHeapUsedBytes: metric.peakHeapUsedBytes,
        peakHeapUsedUnavailableReason: null,
        playlistId: null,
        postGcHeapUnavailableReason: null,
        postGcHeapUsedBytes: metric.postGcHeapUsedBytes,
        profilePath: null,
        requests: metric.requests.evidence.map(cloneRequest),
        responseEpochMs: null,
        snapshotPath: null,
        terminatedEpochMs: null,
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

function createXtreamTimeline(
    raw: XtreamRawIterationResult
): XtreamIpcTimelineRecord[] {
    const main = raw.phaseCapture.events
        .filter(({ phase }) => MAIN_PHASES.has(phase))
        .map((event): XtreamIpcTimelineRecord => ({
            action: event.providerAction,
            boundary: event.boundary,
            categoryType: event.categoryType,
            contentType: event.contentType,
            durationMs: event.durationMs,
            epochMs: event.epochMs,
            phase: event.phase,
            requestId: event.correlationId,
            type: 'xtream-main-phase',
        }));
    const markers = xtreamCalls(raw).flatMap(({ request, response }) => [
        marker(raw, request, 'start'),
        marker(raw, response, 'end'),
    ]);
    return [...main, ...markers].sort((left, right) => {
        return left.epochMs - right.epochMs;
    });
}

function marker(
    raw: XtreamRawIterationResult,
    span: XtreamIpcAttributionSpan,
    boundary: 'end' | 'start'
): XtreamIpcTimelineRecord {
    const semantic = markerSemantic(raw, span);
    return {
        action: semantic.providerAction,
        boundary,
        categoryType: semantic.categoryType,
        contentType: semantic.contentType,
        epochMs: span.endEpochMs,
        ipcCallId: span.ipcCallId,
        itemCount: null,
        method: span.method,
        operationId:
            span.method === 'dbCancelOperation'
                ? raw.cancellation.failedOperationId
                : semantic.operationId,
        outcome: boundary === 'start' ? null : span.outcome,
        playlistId: semantic.playlistId,
        sessionId: span.method.startsWith('xtream') ? 'session-1' : null,
        sourceEpochMs:
            boundary === 'start' ? span.sourceEpochMs : span.startEpochMs,
        type: 'xtream-preload-marker',
    };
}

function markerSemantic(
    raw: XtreamRawIterationResult,
    span: XtreamIpcAttributionSpan
) {
    if (span.method === 'xtreamRequest') {
        const providers = providerGroups(raw.phaseCapture);
        const calls = xtreamCalls(raw).filter(
            ({ request }) => request.method === 'xtreamRequest'
        );
        const index = calls.findIndex(
            ({ request }) => request.ipcCallId === span.ipcCallId
        );
        const provider = providers[index]?.[0];
        return {
            categoryType: null,
            contentType: null,
            operationId: null,
            playlistId: null,
            providerAction: provider?.providerAction ?? null,
        };
    }
    const request = raw.databaseWorker.requests.evidence.find(
        (candidate) =>
            candidate.ipcCallId === span.ipcCallId &&
            xtreamIpcProducerNamespaceForWorkerOperation(
                candidate.operation ?? ''
            ) === XTREAM_IPC_PRODUCER_NAMESPACE.XTREAM_PRELOAD
    );
    const event = raw.phaseCapture.events.find(
        (candidate) =>
            candidate.correlationId === request?.requestId &&
            candidate.boundary === 'start'
    );
    return {
        categoryType: event?.categoryType ?? null,
        contentType: event?.contentType ?? null,
        operationId: request?.operationId ?? null,
        playlistId: request?.playlistId ?? null,
        providerAction: null,
    };
}

function xtreamCalls(raw: XtreamRawIterationResult) {
    return pairIpc(raw.phaseCapture.ipcSpans).filter(
        ({ request }) =>
            xtreamIpcProducerNamespaceForMethod(request.method) ===
            XTREAM_IPC_PRODUCER_NAMESPACE.XTREAM_PRELOAD
    );
}

function pairIpc(spans: readonly XtreamIpcAttributionSpan[]) {
    const groups = new Map<string, XtreamIpcAttributionSpan[]>();
    for (const span of spans) {
        groups.set(span.correlationId, [
            ...(groups.get(span.correlationId) ?? []),
            span,
        ]);
    }
    return [...groups.values()].map((group) => {
        const request = group.find(({ boundary }) => boundary === 'request');
        const response = group.find(({ boundary }) => boundary === 'response');
        if (!request || !response) {
            throw new Error('invalid Xtream assembler IPC fixture');
        }
        return { request, response };
    });
}

function providerGroups(capture: XtreamPhaseAttributionInput) {
    const groups = new Map<string, typeof capture.events>();
    for (const event of capture.events.filter(
        ({ phase }) => phase === PHASE.NETWORK_TOTAL
    )) {
        groups.set(event.correlationId, [
            ...(groups.get(event.correlationId) ?? []),
            event,
        ]);
    }
    return [...groups.values()].sort((left, right) => {
        const leftStart = left[0];
        const rightStart = right[0];
        if (!leftStart || !rightStart) {
            throw new Error('invalid Xtream assembler provider fixture');
        }
        return leftStart.epochMs - rightStart.epochMs;
    });
}
