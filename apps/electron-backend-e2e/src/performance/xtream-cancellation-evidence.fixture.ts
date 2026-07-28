import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import type { DatabaseWorkerCancelTimelineRecord } from './database-worker-cancel-capture';
import type {
    XtreamAttributionPhaseEvent,
    XtreamIpcAttributionSpan,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import {
    XTREAM_IPC_PRODUCER_NAMESPACE,
    xtreamIpcProducerNamespaceForMethod,
} from './xtream-ipc-producer-identity';
import { XTREAM_ATTRIBUTION_PHASE as PHASE } from './xtream-phase-inventory';
import type { XtreamCancellationMetrics } from './xtream-summary-contract';
import type { XtreamCancellationEvidence } from './xtream-summary-contract';

export function bindFixtureCancellationEvidence(
    input: XtreamPhaseAttributionInput,
    requests: readonly WorkerRequestPerformanceMetrics[]
): {
    readonly cancellation: XtreamCancellationMetrics;
    readonly cancellationEvidence: XtreamCancellationEvidence | null;
    readonly phaseCapture: XtreamPhaseAttributionInput;
} {
    if (input.scenarioId !== 'xtream-cancel-import') {
        return {
            cancellation: emptyCancellation(),
            cancellationEvidence: null,
            phaseCapture: input,
        };
    }
    const failed = requests.filter(
        ({ operation, success }) => operation === 'DB_SAVE_CONTENT' && !success
    );
    const request = failed[0];
    if (
        failed.length !== 1 ||
        !request ||
        typeof request.requestId !== 'string' ||
        typeof request.operationId !== 'string' ||
        request.workEndedEpochMs === null
    ) {
        fixtureError();
    }
    const write = phaseSpan(
        input.events,
        PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
        request.requestId
    );
    const cancel = phaseSpan(input.events, PHASE.CANCEL_SESSION);
    const clickEpochMs = write.startEpochMs + 0.25;
    const networkPreloadStartEpochMs = clickEpochMs + 0.25;
    const networkPreloadReturnEpochMs = cancel.endEpochMs + 0.25;
    const preloadStartEpochMs = networkPreloadReturnEpochMs + 0.25;
    const databaseDispatchEpochMs = preloadStartEpochMs + 0.5;
    const preloadReturnEpochMs = databaseDispatchEpochMs + 0.5;
    const workerReceiptEpochMs = preloadReturnEpochMs + 0.25;
    const workerTerminalEpochMs = workerReceiptEpochMs + 0.25;
    if (
        databaseDispatchEpochMs > write.endEpochMs ||
        workerTerminalEpochMs > request.workEndedEpochMs ||
        workerTerminalEpochMs > request.responseEpochMs
    ) {
        fixtureError();
    }
    const authoritativeTerminalEpochMs = request.responseEpochMs;
    const paintedEpochMs = input.uiPaintEpochMs;
    const ipcSpans = resequenceFixtureIpcSpans(
        input.ipcSpans.map((span) => {
            if (span.method === 'xtreamCancelSession') {
                return retime(
                    span,
                    networkPreloadStartEpochMs,
                    cancel.startEpochMs,
                    cancel.endEpochMs,
                    networkPreloadReturnEpochMs
                );
            }
            if (span.method === 'dbCancelOperation') {
                return retime(
                    span,
                    preloadStartEpochMs,
                    databaseDispatchEpochMs - 0.25,
                    databaseDispatchEpochMs + 0.25,
                    preloadReturnEpochMs
                );
            }
            return span;
        })
    );
    const databasePreload = ipcSpans.find(
        ({ boundary, method }) =>
            boundary === 'request' && method === 'dbCancelOperation'
    );
    if (!databasePreload) fixtureError();
    const cancelTimeline = cancellationTimeline(
        request,
        databasePreload,
        databaseDispatchEpochMs,
        workerReceiptEpochMs,
        workerTerminalEpochMs
    );
    return {
        cancellation: {
            acknowledgementLatencyMs:
                authoritativeTerminalEpochMs - clickEpochMs,
            authoritativeDatabaseAcknowledgementObserved: true,
            authoritativeTerminalEpochMs,
            clickEpochMs,
            clickToDatabaseDispatchMs: databaseDispatchEpochMs - clickEpochMs,
            clickToPaintMs: paintedEpochMs - clickEpochMs,
            clickToPreloadReturnMs: preloadReturnEpochMs - clickEpochMs,
            databaseDispatchEpochMs,
            failedDatabaseRequestId: request.requestId,
            failedOperationId: request.operationId,
            mainNetworkAbortObserved: false,
            mainNetworkAbortReason: 'cancel-triggered-after-network-complete',
            paintedEpochMs,
            preloadReturnEpochMs,
            preloadStartEpochMs,
            workerReceiptEpochMs,
            workerReceiptIsAuthoritative: false,
            workerReceiptLatencyMs: workerReceiptEpochMs - clickEpochMs,
        },
        cancellationEvidence: { timeline: cancelTimeline },
        phaseCapture: { ...input, ipcSpans },
    };
}

function cancellationTimeline(
    request: WorkerRequestPerformanceMetrics,
    databasePreload: XtreamIpcAttributionSpan,
    dispatchEpochMs: number,
    receiptEpochMs: number,
    terminalEpochMs: number
): readonly DatabaseWorkerCancelTimelineRecord[] {
    if (
        typeof request.requestId !== 'string' ||
        typeof request.operationId !== 'string'
    ) {
        fixtureError();
    }
    const identity = {
        ipcCallId: databasePreload.ipcCallId,
        operationId: request.operationId,
        requestId: request.requestId,
        sourceEpochMs: databasePreload.sourceEpochMs,
    };
    return [
        {
            ...identity,
            epochMs: dispatchEpochMs,
            type: 'db-cancel-dispatched',
        },
        {
            ...identity,
            epochMs: receiptEpochMs,
            type: 'db-cancel-received',
        },
        {
            ...identity,
            epochMs: terminalEpochMs,
            type: 'db-cancel-terminal-received',
        },
    ];
}

function emptyCancellation(): XtreamCancellationMetrics {
    return {
        acknowledgementLatencyMs: null,
        authoritativeDatabaseAcknowledgementObserved: false,
        authoritativeTerminalEpochMs: null,
        clickEpochMs: null,
        clickToDatabaseDispatchMs: null,
        clickToPaintMs: null,
        clickToPreloadReturnMs: null,
        databaseDispatchEpochMs: null,
        failedDatabaseRequestId: null,
        failedOperationId: null,
        mainNetworkAbortObserved: false,
        mainNetworkAbortReason: null,
        paintedEpochMs: null,
        preloadReturnEpochMs: null,
        preloadStartEpochMs: null,
        workerReceiptEpochMs: null,
        workerReceiptIsAuthoritative: false,
        workerReceiptLatencyMs: null,
    };
}

function retime(
    span: XtreamIpcAttributionSpan,
    requestStartEpochMs: number,
    requestEndEpochMs: number,
    responseStartEpochMs: number,
    responseEndEpochMs: number
): XtreamIpcAttributionSpan {
    return {
        ...span,
        endEpochMs:
            span.boundary === 'request'
                ? requestEndEpochMs
                : responseEndEpochMs,
        startEpochMs:
            span.boundary === 'request'
                ? requestStartEpochMs
                : responseStartEpochMs,
        sourceEpochMs: requestStartEpochMs,
    };
}

function resequenceFixtureIpcSpans(
    spans: readonly XtreamIpcAttributionSpan[]
): readonly XtreamIpcAttributionSpan[] {
    const groups = new Map<string, XtreamIpcAttributionSpan[]>();
    for (const span of spans) {
        groups.set(span.correlationId, [
            ...(groups.get(span.correlationId) ?? []),
            span,
        ]);
    }
    const calls = [...groups.entries()].map(([correlationId, call]) => {
        const span = call[0];
        if (
            call.length !== 2 ||
            !span ||
            call.some(
                (candidate) =>
                    candidate.ipcCallId !== span.ipcCallId ||
                    candidate.sourceEpochMs !== span.sourceEpochMs
            )
        ) {
            fixtureError();
        }
        const namespace = xtreamIpcProducerNamespaceForMethod(span.method);
        if (namespace === null) fixtureError();
        return { correlationId, namespace, span };
    });
    const reassigned = new Map<string, number>();
    for (const namespace of Object.values(XTREAM_IPC_PRODUCER_NAMESPACE)) {
        const selected = calls
            .filter((call) => call.namespace === namespace)
            .sort(
                (left, right) =>
                    left.span.sourceEpochMs - right.span.sourceEpochMs ||
                    left.span.ipcCallId - right.span.ipcCallId
            );
        const ids = selected
            .map(({ span }) => span.ipcCallId)
            .sort((left, right) => left - right);
        if (new Set(ids).size !== ids.length) fixtureError();
        selected.forEach(({ correlationId }, index) => {
            const ipcCallId = ids[index];
            if (!ipcCallId) fixtureError();
            reassigned.set(correlationId, ipcCallId);
        });
    }
    return spans.map((span) => {
        const ipcCallId = reassigned.get(span.correlationId);
        if (!ipcCallId) fixtureError();
        return { ...span, ipcCallId };
    });
}

function phaseSpan(
    events: readonly XtreamAttributionPhaseEvent[],
    phase: string,
    correlationId?: string
): { readonly endEpochMs: number; readonly startEpochMs: number } {
    const selected = events.filter(
        (event) =>
            event.phase === phase &&
            (correlationId === undefined ||
                event.correlationId === correlationId)
    );
    const start = selected.find(({ boundary }) => boundary === 'start');
    const end = selected.find(({ boundary }) => boundary === 'end');
    if (selected.length !== 2 || !start || !end) fixtureError();
    return { endEpochMs: end.epochMs, startEpochMs: start.epochMs };
}

function fixtureError(): never {
    throw new Error('invalid Xtream cancellation fixture evidence');
}
