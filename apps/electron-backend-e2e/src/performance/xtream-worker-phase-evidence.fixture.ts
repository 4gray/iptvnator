import type {
    DatabaseWorkerPerformancePhase,
    PerformancePhaseEvent,
} from '@iptvnator/shared/interfaces';

import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import type {
    XtreamAttributionPhaseEvent,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import { XTREAM_ATTRIBUTION_PHASE as PHASE } from './xtream-phase-inventory';
import { normalizeWorkerRequestPerformanceOutcome } from './worker-request-performance';

const WORKER_PHASES = new Set<string>([
    PHASE.DESERIALIZE_PLAYLIST,
    PHASE.NORMALIZE_CATEGORIES,
    PHASE.NORMALIZE_CONTENT,
    PHASE.NORMALIZE_SEARCH_RANK,
    PHASE.SERIALIZE_PLAYLIST,
    PHASE.SQLITE_CATEGORIES_READ,
    PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
    PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
    PHASE.SQLITE_CONTENT_READ,
    PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
    PHASE.SQLITE_GENERIC_READ,
    PHASE.SQLITE_GENERIC_WRITE,
    PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
    PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
    PHASE.SQLITE_SEARCH_QUERY,
    PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
    PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
    PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
]);

interface WorkerGroup {
    readonly correlationId: string;
    readonly events: readonly XtreamAttributionPhaseEvent[];
    readonly phaseSignature: string;
}

export function bindFixtureWorkerEvidence(
    input: XtreamPhaseAttributionInput,
    requests: readonly WorkerRequestPerformanceMetrics[]
): {
    readonly phaseCapture: XtreamPhaseAttributionInput;
    readonly requests: readonly WorkerRequestPerformanceMetrics[];
} {
    const groups = workerGroups(input.events);
    const unused = new Set(groups);
    const replacements = new Map<
        string,
        readonly XtreamAttributionPhaseEvent[]
    >();
    const bound = requests.map((request) => {
        if (request.phaseEvents.length === 0) return request;
        const phaseSignature = signature(
            request.phaseEvents
                .filter(({ boundary }) => boundary === 'end')
                .map(({ phase }) => phase)
        );
        const candidates = groups.filter(
            (group) =>
                unused.has(group) && group.phaseSignature === phaseSignature
        );
        const matched =
            candidates.find((group) => sameCounts(group, request)) ??
            candidates[0];
        if (!matched) fixtureError();
        unused.delete(matched);
        const events = replaceItemCounts(matched, request);
        replacements.set(matched.correlationId, events);
        return alignRequest(request, matched.correlationId, events);
    });
    if (unused.size !== 0) fixtureError();
    return {
        phaseCapture: {
            ...input,
            events: input.events.map((event) => {
                if (!WORKER_PHASES.has(event.phase)) return event;
                const replacement = replacements
                    .get(event.correlationId)
                    ?.find(
                        (candidate) =>
                            candidate.phase === event.phase &&
                            candidate.boundary === event.boundary
                    );
                if (!replacement) fixtureError();
                return replacement;
            }),
        },
        requests: resequenceFixtureIpcCallIds(bound),
    };
}

function resequenceFixtureIpcCallIds(
    requests: readonly WorkerRequestPerformanceMetrics[]
): readonly WorkerRequestPerformanceMetrics[] {
    const correlated = requests
        .filter(
            (request) =>
                request.ipcCallId !== null && request.sourceEpochMs !== null
        )
        .sort(
            (left, right) =>
                Number(left.sourceEpochMs) - Number(right.sourceEpochMs) ||
                Number(left.ipcCallId) - Number(right.ipcCallId)
        );
    const ids = correlated
        .map(({ ipcCallId }) => Number(ipcCallId))
        .sort((left, right) => left - right);
    const reassigned = new Map(
        correlated.map((request, index) => [request, ids[index]])
    );
    return requests.map((request) => {
        const ipcCallId = reassigned.get(request);
        return ipcCallId === undefined ? request : { ...request, ipcCallId };
    });
}

function workerGroups(
    events: readonly XtreamAttributionPhaseEvent[]
): readonly WorkerGroup[] {
    const grouped = new Map<string, XtreamAttributionPhaseEvent[]>();
    for (const event of events) {
        if (!WORKER_PHASES.has(event.phase)) continue;
        grouped.set(event.correlationId, [
            ...(grouped.get(event.correlationId) ?? []),
            event,
        ]);
    }
    return [...grouped.entries()].map(([correlationId, selected]) => ({
        correlationId,
        events: selected,
        phaseSignature: signature(
            selected
                .filter(({ boundary }) => boundary === 'end')
                .map(({ phase }) => phase)
        ),
    }));
}

function sameCounts(
    group: WorkerGroup,
    request: WorkerRequestPerformanceMetrics
): boolean {
    const captured = group.events
        .filter(({ boundary }) => boundary === 'end')
        .map(({ itemCount }) => itemCount);
    const requested = request.phaseEvents
        .filter(({ boundary }) => boundary === 'end')
        .map(({ metadata }) => metadata?.itemCount ?? null);
    return JSON.stringify(captured) === JSON.stringify(requested);
}

function replaceItemCounts(
    group: WorkerGroup,
    request: WorkerRequestPerformanceMetrics
): readonly XtreamAttributionPhaseEvent[] {
    const counts = request.phaseEvents
        .filter(({ boundary }) => boundary === 'end')
        .map(({ metadata }) => metadata?.itemCount ?? null);
    let endIndex = 0;
    return group.events.map((event) => ({
        ...event,
        itemCount:
            event.boundary === 'end' ? (counts[endIndex++] ?? null) : null,
    }));
}

function alignRequest(
    request: WorkerRequestPerformanceMetrics,
    requestId: string,
    events: readonly XtreamAttributionPhaseEvent[]
): WorkerRequestPerformanceMetrics {
    const phaseEvents = events.map(
        (event): PerformancePhaseEvent<DatabaseWorkerPerformancePhase> => ({
            boundary: event.boundary,
            durationMs: event.durationMs,
            epochMs: event.epochMs,
            ...(event.boundary === 'end' && event.itemCount !== null
                ? { metadata: { itemCount: event.itemCount } }
                : {}),
            phase: event.phase as DatabaseWorkerPerformancePhase,
            requestId,
        })
    );
    const firstEpochMs = Math.min(...events.map(({ epochMs }) => epochMs));
    const lastEpochMs = Math.max(...events.map(({ epochMs }) => epochMs));
    const requestReceivedEpochMs = firstEpochMs - 2;
    const workStartedEpochMs = firstEpochMs - 1;
    const workEndedEpochMs = lastEpochMs + 0.25;
    const histogramFlushedEpochMs =
        request.histogramFlushedEpochMs === null
            ? null
            : workEndedEpochMs + 0.25;
    const responsePostedEpochMs = workEndedEpochMs + 0.5;
    return normalizeWorkerRequestPerformanceOutcome({
        ipcCallId: request.ipcCallId,
        operation: request.operation,
        operationId: request.operationId,
        operationIdUnavailableReason: request.operationIdUnavailableReason,
        performanceCapture: {
            eventLoopDelay: request.eventLoopDelay,
            eventLoopDelayUnavailableReason:
                request.eventLoopDelayUnavailableReason,
            eventLoopUtilization: request.eventLoopUtilization,
            eventLoopUtilizationUnavailableReason:
                request.eventLoopUtilizationUnavailableReason,
            histogramFlushedEpochMs,
            invalidReason: request.invalidReason,
            phaseEvents,
            requestReceivedEpochMs,
            responsePostedEpochMs,
            threadCpuSystemMicros: request.threadCpuSystemMicros,
            threadCpuUnavailableReason: request.threadCpuUnavailableReason,
            threadCpuUserMicros: request.threadCpuUserMicros,
            workEndedEpochMs,
            workStartedEpochMs,
        },
        playlistId: request.playlistId,
        requestId,
        responseEpochMs: responsePostedEpochMs + 0.25,
        sourceEpochMs:
            request.ipcCallId === null ? null : requestReceivedEpochMs - 0.25,
        success: request.success,
    });
}

function signature(phases: readonly string[]): string {
    return phases.join('\0');
}

function fixtureError(): never {
    throw new Error('invalid Xtream worker phase fixture binding');
}
