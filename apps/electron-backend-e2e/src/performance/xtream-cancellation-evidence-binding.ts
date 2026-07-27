import type { DatabaseWorkerCancelTimelineRecord } from './database-worker-cancel-capture';
import { snapshotXtreamCancellationEvidence } from './xtream-cancellation-evidence-snapshot';
import {
    isFiniteNonNegative,
    isPositiveSafeInteger,
} from './xtream-exact-schema';
import type {
    XtreamAttributionPhaseEvent,
    XtreamIpcAttributionSpan,
} from './xtream-phase-attribution';
import {
    hasDistinctMonotonicXtreamIpcProducerIdentities,
    XTREAM_IPC_PRODUCER_NAMESPACE,
    xtreamIpcProducerNamespaceForWorkerOperation,
    type XtreamIpcProducerIdentity,
} from './xtream-ipc-producer-identity';
import { XTREAM_ATTRIBUTION_PHASE as PHASE } from './xtream-phase-inventory';
import type {
    XtreamCancellationMetrics,
    XtreamRawIterationResult,
} from './xtream-summary-contract';

type WorkerRequest =
    XtreamRawIterationResult['databaseWorker']['requests']['evidence'][number];

const RECORD_TYPES = [
    'db-cancel-dispatched',
    'db-cancel-received',
    'db-cancel-terminal-received',
] as const;

export function assertXtreamCancellationEvidenceBinding(
    raw: XtreamRawIterationResult,
    events: readonly XtreamAttributionPhaseEvent[],
    ipcSpans: readonly XtreamIpcAttributionSpan[],
    requests: readonly WorkerRequest[]
): void {
    const failed = requests.filter(
        ({ operation, success }) => operation === 'DB_SAVE_CONTENT' && !success
    );
    if (raw.scenarioId !== 'xtream-cancel-import') {
        if (failed.length !== 0 || raw.cancellationEvidence !== null) invalid();
        return;
    }
    const request = failed[0];
    if (
        failed.length !== 1 ||
        !request ||
        typeof request.requestId !== 'string' ||
        typeof request.operationId !== 'string' ||
        raw.cancellation.failedDatabaseRequestId !== request.requestId ||
        raw.cancellation.failedOperationId !== request.operationId
    ) {
        invalid();
    }
    const timeline = cancellationTimeline(raw, request);
    const databasePreload = ipcPair(ipcSpans, 'dbCancelOperation');
    assertCancellationProducerIdentity(timeline, databasePreload[0], requests);
    assertCancellationTimeline(
        raw.cancellation,
        request,
        timeline,
        phaseSpan(
            events,
            PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
            request.requestId
        ),
        phaseSpan(events, PHASE.CANCEL_SESSION),
        phaseSpan(events, PHASE.STORE_IMPORT_TERMINAL),
        ipcPair(ipcSpans, 'xtreamCancelSession'),
        databasePreload,
        raw.phaseCapture.uiPaintEpochMs
    );
}

interface Span {
    readonly endEpochMs: number;
    readonly startEpochMs: number;
}

function assertCancellationTimeline(
    value: XtreamCancellationMetrics,
    request: WorkerRequest,
    timeline: readonly DatabaseWorkerCancelTimelineRecord[],
    write: Span,
    networkCancel: Span,
    terminal: Span,
    networkPreload: readonly [
        XtreamIpcAttributionSpan,
        XtreamIpcAttributionSpan,
    ],
    databasePreload: readonly [
        XtreamIpcAttributionSpan,
        XtreamIpcAttributionSpan,
    ],
    uiPaintEpochMs: number
): void {
    const [dispatchRecord, receiptRecord, workerTerminalRecord] = timeline;
    if (!dispatchRecord || !receiptRecord || !workerTerminalRecord) invalid();
    const click = epoch(value.clickEpochMs);
    const preloadStart = epoch(value.preloadStartEpochMs);
    const preloadReturn = epoch(value.preloadReturnEpochMs);
    const dispatch = epoch(value.databaseDispatchEpochMs);
    const receipt = epoch(value.workerReceiptEpochMs);
    const authoritative = epoch(value.authoritativeTerminalEpochMs);
    const painted = epoch(value.paintedEpochMs);
    if (
        request.requestReceivedEpochMs === null ||
        request.workEndedEpochMs === null ||
        click < write.startEpochMs ||
        click < request.requestReceivedEpochMs ||
        click > write.endEpochMs ||
        networkPreload[0].startEpochMs < click ||
        networkPreload[0].endEpochMs > networkCancel.startEpochMs ||
        networkCancel.endEpochMs > networkPreload[1].startEpochMs ||
        networkPreload[1].endEpochMs > databasePreload[0].startEpochMs ||
        preloadStart !== databasePreload[0].startEpochMs ||
        dispatchRecord.ipcCallId !== databasePreload[0].ipcCallId ||
        dispatchRecord.sourceEpochMs !== databasePreload[0].sourceEpochMs ||
        databasePreload[0].endEpochMs > dispatch ||
        dispatch !== dispatchRecord.epochMs ||
        dispatch < request.requestReceivedEpochMs ||
        dispatch > write.endEpochMs ||
        databasePreload[1].startEpochMs < dispatch ||
        preloadReturn !== databasePreload[1].endEpochMs ||
        preloadReturn < dispatch ||
        preloadReturn > authoritative ||
        receipt !== receiptRecord.epochMs ||
        receipt < dispatch ||
        receipt > request.workEndedEpochMs ||
        receipt > authoritative ||
        workerTerminalRecord.epochMs < receipt ||
        workerTerminalRecord.epochMs > authoritative ||
        authoritative !== request.responseEpochMs ||
        terminal.startEpochMs < authoritative ||
        terminal.endEpochMs > painted ||
        painted !== uiPaintEpochMs
    ) {
        invalid();
    }
}

function cancellationTimeline(
    raw: XtreamRawIterationResult,
    request: WorkerRequest
): readonly DatabaseWorkerCancelTimelineRecord[] {
    const evidence = snapshotXtreamCancellationEvidence(
        raw.cancellationEvidence
    );
    if (evidence === null) invalid();
    const timeline = evidence.timeline;
    if (timeline.length !== RECORD_TYPES.length) invalid();
    const first = timeline[0];
    if (!first) invalid();
    for (let index = 0; index < timeline.length; index += 1) {
        const record = timeline[index];
        if (
            !record ||
            record.type !== RECORD_TYPES[index] ||
            !isFiniteNonNegative(record.epochMs) ||
            !isFiniteNonNegative(record.sourceEpochMs) ||
            !isPositiveSafeInteger(record.ipcCallId) ||
            typeof record.operationId !== 'string' ||
            record.operationId.length === 0 ||
            typeof record.requestId !== 'string' ||
            record.requestId.length === 0 ||
            record.ipcCallId !== first.ipcCallId ||
            record.operationId !== first.operationId ||
            record.requestId !== first.requestId ||
            record.sourceEpochMs !== first.sourceEpochMs
        ) {
            invalid();
        }
    }
    if (
        first.requestId !== request.requestId ||
        first.operationId !== request.operationId
    ) {
        invalid();
    }
    return timeline;
}

function assertCancellationProducerIdentity(
    timeline: readonly DatabaseWorkerCancelTimelineRecord[],
    databasePreload: XtreamIpcAttributionSpan,
    requests: readonly WorkerRequest[]
): void {
    const dispatch = timeline[0];
    if (
        !dispatch ||
        dispatch.ipcCallId !== databasePreload.ipcCallId ||
        dispatch.sourceEpochMs !== databasePreload.sourceEpochMs
    ) {
        invalid();
    }
    const identities: XtreamIpcProducerIdentity[] = [];
    for (const { ipcCallId, operation, sourceEpochMs } of requests) {
        if (ipcCallId === null && sourceEpochMs === null) continue;
        const namespace = xtreamIpcProducerNamespaceForWorkerOperation(
            typeof operation === 'string' ? operation : ''
        );
        if (
            namespace === null ||
            !isPositiveSafeInteger(ipcCallId) ||
            !isFiniteNonNegative(sourceEpochMs)
        ) {
            invalid();
        }
        if (namespace === XTREAM_IPC_PRODUCER_NAMESPACE.XTREAM_PRELOAD) {
            identities.push({ ipcCallId, namespace, sourceEpochMs });
        }
    }
    identities.push({
        ipcCallId: databasePreload.ipcCallId,
        namespace: XTREAM_IPC_PRODUCER_NAMESPACE.XTREAM_PRELOAD,
        sourceEpochMs: databasePreload.sourceEpochMs,
    });
    if (!hasDistinctMonotonicXtreamIpcProducerIdentities(identities)) {
        invalid();
    }
}

function phaseSpan(
    events: readonly XtreamAttributionPhaseEvent[],
    phase: string,
    correlationId?: string
): Span {
    const selected = events.filter(
        (event) =>
            event.phase === phase &&
            (correlationId === undefined ||
                event.correlationId === correlationId)
    );
    const start = selected.find(({ boundary }) => boundary === 'start');
    const end = selected.find(({ boundary }) => boundary === 'end');
    if (selected.length !== 2 || !start || !end) invalid();
    return { endEpochMs: end.epochMs, startEpochMs: start.epochMs };
}

function ipcPair(
    spans: readonly XtreamIpcAttributionSpan[],
    method: string
): readonly [XtreamIpcAttributionSpan, XtreamIpcAttributionSpan] {
    const selected = spans.filter((span) => span.method === method);
    const request = selected.find(({ boundary }) => boundary === 'request');
    const response = selected.find(({ boundary }) => boundary === 'response');
    if (selected.length !== 2 || !request || !response) invalid();
    return [request, response];
}

function epoch(value: number | null): number {
    if (!isFiniteNonNegative(value)) invalid();
    return value;
}

function invalid(): never {
    throw new Error('invalid Xtream persisted cancellation evidence');
}
