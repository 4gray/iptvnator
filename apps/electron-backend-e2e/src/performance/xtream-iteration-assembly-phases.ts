import { pairRendererPerformancePhaseEvents } from './renderer-performance-phase-events';
import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import type { XtreamMainCaptureResult } from './m3u-refresh-main-capture';
import type {
    XtreamAttributionPhaseEvent,
    XtreamIpcAttributionSpan,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import {
    XTREAM_ATTRIBUTION_PHASE as PHASE,
    XTREAM_PHASE_SEMANTIC_TYPE as SEMANTIC,
    type XtreamPhaseSemanticType,
} from './xtream-phase-inventory';
import {
    semanticTypeFromXtreamPhaseSource,
    xtreamDataSemanticSource,
    type XtreamPhaseSemanticSource,
} from './xtream-phase-semantic-source';
import {
    XTREAM_IPC_PRODUCER_NAMESPACE,
    xtreamIpcProducerIdentityKey,
    xtreamIpcProducerNamespaceForWorkerOperation,
} from './xtream-ipc-producer-identity';
import { xtreamWorkerOperationForIpcMethod } from './xtream-ipc-worker-identity-binding';
import type { XtreamIpcTimelineRecord } from './xtream-ipc-marker-events.model';
import type { XtreamRendererCaptureMetrics } from './xtream-renderer-capture';

const MAIN_PHASES = new Set<string>([
    PHASE.CANCEL_SESSION,
    PHASE.JSON_TRANSFORM,
    PHASE.NETWORK_TOTAL,
    PHASE.RESPONSE_READY,
]);
const LEGACY_METHODS = Object.freeze({
    DB_GET_APP_PLAYLIST: 'dbGetAppPlaylist',
    DB_UPSERT_APP_PLAYLIST: 'dbUpsertAppPlaylist',
});
const LEGACY_RESPONSE_CLOCK_SKEW_TOLERANCE_MS = 1;

export function deriveXtreamPhaseCapture(
    scenarioId: XtreamPhaseAttributionInput['scenarioId'],
    main: XtreamMainCaptureResult,
    renderer: XtreamRendererCaptureMetrics
): XtreamPhaseAttributionInput {
    const operationStartEpochMs = renderer.probe.operationStartEpochMs;
    const rendererTerminalEpochMs = requireEpoch(
        renderer.probe.terminalEpochMs
    );
    const uiPaintEpochMs = requireEpoch(renderer.probe.uiPaintedEpochMs);
    const events = [
        ...mainPhaseEvents(main),
        ...workerPhaseEvents(main.requests, main),
        ...rendererPhaseEvents(renderer),
    ];
    const ipc = ipcSpans(main);
    const terminalEpochMs = Math.max(
        rendererTerminalEpochMs,
        ...events.map(({ epochMs }) => epochMs),
        ...ipc.map(({ endEpochMs }) => endEpochMs)
    );
    return Object.freeze({
        backgroundSearchMarkerObserved: events.some(
            ({ phase }) => phase === PHASE.STORE_SEARCH_RESULTS
        ),
        events: Object.freeze(events),
        ipcSpans: Object.freeze(ipc),
        operationStartEpochMs,
        scenarioId,
        terminalEpochMs,
        uiPaintEpochMs,
    });
}

function mainPhaseEvents(
    main: XtreamMainCaptureResult
): XtreamAttributionPhaseEvent[] {
    return main.ipcTimeline
        .filter(
            ({ phase, type }) =>
                type === 'xtream-main-phase' &&
                typeof phase === 'string' &&
                MAIN_PHASES.has(phase)
        )
        .map((record) => {
            const source = {
                categoryType: record.categoryType ?? null,
                contentType: record.contentType ?? null,
                providerAction: record.action ?? null,
            } as XtreamPhaseSemanticSource;
            return phaseEvent({
                boundary: record.boundary,
                correlationId: requireText(record.requestId),
                durationMs: record.durationMs ?? null,
                epochMs: record.epochMs,
                itemCount: null,
                phase: requireText(record.phase),
                source,
            });
        });
}

function workerPhaseEvents(
    requests: readonly WorkerRequestPerformanceMetrics[],
    main: XtreamMainCaptureResult
): XtreamAttributionPhaseEvent[] {
    return requests.flatMap((request) => {
        const correlationId = requireText(request.requestId);
        const source = workerSemanticSource(request, main);
        return request.phaseEvents.map((event) =>
            phaseEvent({
                boundary: event.boundary,
                correlationId,
                durationMs: event.durationMs,
                epochMs: event.epochMs,
                itemCount:
                    event.boundary === 'end'
                        ? (event.metadata?.itemCount ?? null)
                        : null,
                phase: event.phase,
                source,
            })
        );
    });
}

function workerSemanticSource(
    request: WorkerRequestPerformanceMetrics,
    main: XtreamMainCaptureResult
): XtreamPhaseSemanticSource {
    const operation = requireText(request.operation);
    const namespace = xtreamIpcProducerNamespaceForWorkerOperation(operation);
    if (namespace !== XTREAM_IPC_PRODUCER_NAMESPACE.XTREAM_PRELOAD) {
        return xtreamDataSemanticSource(null);
    }
    const marker = main.ipcTimeline.filter(
        (record) =>
            record.type === 'xtream-preload-marker' &&
            record.boundary === 'start' &&
            record.ipcCallId === request.ipcCallId &&
            record.sourceEpochMs === request.sourceEpochMs &&
            xtreamWorkerOperationForIpcMethod(record.method ?? '') === operation
    );
    if (marker.length !== 1 || !marker[0]) invalid();
    return {
        categoryType: marker[0].categoryType ?? null,
        contentType: marker[0].contentType ?? null,
        providerAction: null,
    } as XtreamPhaseSemanticSource;
}

function rendererPhaseEvents(
    renderer: XtreamRendererCaptureMetrics
): XtreamAttributionPhaseEvent[] {
    return pairRendererPerformancePhaseEvents(
        renderer.probe.performancePhaseEvents
    ).flatMap((span) => {
        const source = rendererSemanticSource(span.phase);
        const itemCount = span.metadata?.items ?? null;
        return [
            phaseEvent({
                boundary: 'start',
                correlationId: span.phaseId,
                durationMs: null,
                epochMs: span.startedEpochMs,
                itemCount: null,
                phase: span.phase,
                source,
            }),
            phaseEvent({
                boundary: 'end',
                correlationId: span.phaseId,
                durationMs: span.durationMs,
                epochMs: span.endedEpochMs,
                itemCount,
                phase: span.phase,
                source,
            }),
        ];
    });
}

function rendererSemanticSource(phase: string): XtreamPhaseSemanticSource {
    const semantic: XtreamPhaseSemanticType | null =
        phase === PHASE.STORE_PUBLISH_LIVE
            ? SEMANTIC.LIVE_CONTENT
            : phase === PHASE.STORE_PUBLISH_VOD
              ? SEMANTIC.VOD_CONTENT
              : phase === PHASE.STORE_PUBLISH_SERIES
                ? SEMANTIC.SERIES_CONTENT
                : null;
    return xtreamDataSemanticSource(semantic);
}

function ipcSpans(main: XtreamMainCaptureResult): XtreamIpcAttributionSpan[] {
    const spans = xtreamIpcSpans(main);
    for (const request of main.requests) {
        const operation = request.operation ?? '';
        const method = LEGACY_METHODS[operation as keyof typeof LEGACY_METHODS];
        if (method) spans.push(...legacyIpcPair(main, request, method));
    }
    return spans;
}

function xtreamIpcSpans(
    main: XtreamMainCaptureResult
): XtreamIpcAttributionSpan[] {
    const groups = new Map<string, typeof main.ipcTimeline>();
    for (const marker of main.ipcTimeline) {
        if (
            marker.type !== 'xtream-preload-marker' ||
            !Number.isSafeInteger(marker.ipcCallId) ||
            typeof marker.method !== 'string'
        ) {
            continue;
        }
        const key = xtreamIpcProducerIdentityKey(
            XTREAM_IPC_PRODUCER_NAMESPACE.XTREAM_PRELOAD,
            Number(marker.ipcCallId)
        );
        groups.set(key, [...(groups.get(key) ?? []), marker]);
    }
    return [...groups.entries()].flatMap(([correlationId, markers]) => {
        const start = markers.find(({ boundary }) => boundary === 'start');
        const end = markers.find(({ boundary }) => boundary === 'end');
        if (
            markers.length !== 2 ||
            !start ||
            !end ||
            start.method !== end.method ||
            start.outcome !== null ||
            !['error', 'success'].includes(String(end.outcome))
        ) {
            invalid();
        }
        const sourceEpochMs = requireEpoch(start.sourceEpochMs);
        return [
            ipcSpan(
                'request',
                correlationId,
                start,
                sourceEpochMs,
                sourceEpochMs,
                end.outcome as 'error' | 'success'
            ),
            ipcSpan(
                'response',
                correlationId,
                end,
                requireEpoch(end.sourceEpochMs),
                sourceEpochMs,
                end.outcome as 'error' | 'success'
            ),
        ];
    });
}

function legacyIpcPair(
    main: XtreamMainCaptureResult,
    request: WorkerRequestPerformanceMetrics,
    method: string
): XtreamIpcAttributionSpan[] {
    const ipcCallId = requirePositiveInteger(request.ipcCallId);
    const sourceEpochMs = requireEpoch(request.sourceEpochMs);
    const requestTimeline = oneTimeline(main, request, 'db-request');
    const success = oneTimeline(main, request, 'preload-performance-success');
    const responseStartEpochMs = requireEpoch(request.responseEpochMs);
    const responseEndEpochMs = normalizeLegacyResponseEndEpochMs(
        requireEpoch(success.sourceEpochMs),
        responseStartEpochMs
    );
    const correlationId = xtreamIpcProducerIdentityKey(
        XTREAM_IPC_PRODUCER_NAMESPACE.LEGACY_PRELOAD,
        ipcCallId
    );
    return [
        {
            boundary: 'request',
            correlationId,
            endEpochMs: requestTimeline.epochMs,
            ipcCallId,
            method,
            outcome: 'success',
            sourceEpochMs,
            startEpochMs: sourceEpochMs,
        },
        {
            boundary: 'response',
            correlationId,
            endEpochMs: responseEndEpochMs,
            ipcCallId,
            method,
            outcome: 'success',
            sourceEpochMs,
            startEpochMs: responseStartEpochMs,
        },
    ];
}

function normalizeLegacyResponseEndEpochMs(
    endEpochMs: number,
    startEpochMs: number
): number {
    if (endEpochMs >= startEpochMs) return endEpochMs;
    if (
        startEpochMs - endEpochMs >=
        LEGACY_RESPONSE_CLOCK_SKEW_TOLERANCE_MS
    ) {
        invalid();
    }
    return startEpochMs;
}

function oneTimeline(
    main: XtreamMainCaptureResult,
    request: WorkerRequestPerformanceMetrics,
    type: 'db-request' | 'preload-performance-success'
) {
    const matches = main.capture.timeline.filter(
        (record) =>
            record.type === type &&
            record.ipcCallId === request.ipcCallId &&
            record.operation === request.operation &&
            record.playlistId === request.playlistId &&
            (type !== 'db-request' ||
                (record.requestId === request.requestId &&
                    record.sourceEpochMs === request.sourceEpochMs))
    );
    if (matches.length !== 1 || !matches[0]) invalid();
    return matches[0];
}

function ipcSpan(
    boundary: 'request' | 'response',
    correlationId: string,
    marker: XtreamIpcTimelineRecord,
    startEpochMs: number,
    sourceEpochMs: number,
    outcome: 'error' | 'success'
): XtreamIpcAttributionSpan {
    return {
        boundary,
        correlationId,
        endEpochMs: marker.epochMs,
        ipcCallId: requirePositiveInteger(marker.ipcCallId),
        method: requireText(marker.method),
        outcome,
        sourceEpochMs,
        startEpochMs,
    };
}

function phaseEvent(input: {
    boundary: 'end' | 'start';
    correlationId: string;
    durationMs: number | null;
    epochMs: number;
    itemCount: number | null;
    phase: string;
    source: XtreamPhaseSemanticSource;
}): XtreamAttributionPhaseEvent {
    const semanticType = semanticTypeFromXtreamPhaseSource(input.source);
    if (semanticType === undefined) invalid();
    return {
        boundary: input.boundary,
        categoryType: input.source.categoryType,
        contentType: input.source.contentType,
        correlationId: input.correlationId,
        durationMs: input.durationMs,
        epochMs: input.epochMs,
        itemCount: input.itemCount,
        phase: input.phase,
        providerAction: input.source.providerAction,
        semanticType,
    };
}

function requireEpoch(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        invalid();
    return value;
}

function requirePositiveInteger(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid();
    return Number(value);
}

function requireText(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) invalid();
    return value;
}

function invalid(): never {
    throw new Error('invalid Xtream assembly phase evidence');
}
