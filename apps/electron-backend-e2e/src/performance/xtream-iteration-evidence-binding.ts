import { isDeepStrictEqual } from 'node:util';

import {
    attributeXtreamPhases,
    type XtreamAttributionPhaseEvent,
} from './xtream-phase-attribution';
import { assertXtreamCancellationEvidenceBinding } from './xtream-cancellation-evidence-binding';
import { isExactRecord } from './xtream-exact-schema';
import { assertXtreamIpcWorkerIdentityBinding } from './xtream-ipc-worker-identity-binding';
import { snapshotXtreamPhaseInput } from './xtream-own-array-snapshot';
import { XTREAM_ATTRIBUTION_PHASE as PHASE } from './xtream-phase-inventory';
import type { XtreamRawIterationResult } from './xtream-summary-contract';

const PHASE_CAPTURE_KEYS = [
    'backgroundSearchMarkerObserved',
    'events',
    'ipcSpans',
    'operationStartEpochMs',
    'scenarioId',
    'terminalEpochMs',
    'uiPaintEpochMs',
] as const;
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
type WorkerBindablePhaseEvent = Omit<
    XtreamAttributionPhaseEvent,
    'categoryType' | 'contentType' | 'providerAction' | 'semanticType'
>;

export function assertXtreamIterationEvidenceBinding(
    raw: XtreamRawIterationResult
): void {
    if (
        !isExactRecord(raw.phaseCapture, PHASE_CAPTURE_KEYS) ||
        raw.phaseCapture.scenarioId !== raw.scenarioId
    ) {
        invalid();
    }
    const canonicalCapture = snapshotXtreamPhaseInput(raw.phaseCapture);
    const events = canonicalCapture.events;
    const ipcSpans = canonicalCapture.ipcSpans;
    const requests = snapshotOwnArray<
        XtreamRawIterationResult['databaseWorker']['requests']['evidence'][number]
    >(raw.databaseWorker.requests.evidence);
    const attributed = attributeXtreamPhases(canonicalCapture);
    if (!isDeepStrictEqual(attributed, raw.phases)) invalid();
    assertWorkerPhaseBinding(events, requests);
    assertXtreamIpcWorkerIdentityBinding(ipcSpans, requests);
    assertXtreamCancellationEvidenceBinding(raw, events, ipcSpans, requests);
}

function assertWorkerPhaseBinding(
    events: readonly XtreamAttributionPhaseEvent[],
    requests: readonly XtreamRawIterationResult['databaseWorker']['requests']['evidence'][number][]
): void {
    const captured = events
        .filter(({ phase }) => WORKER_PHASES.has(phase))
        .map(copyCaptureEvent)
        .sort(compareEvents);
    const projected = requests
        .flatMap((request) => {
            if (typeof request.requestId !== 'string') invalid();
            return snapshotOwnArray<(typeof request.phaseEvents)[number]>(
                request.phaseEvents
            ).map((event): WorkerBindablePhaseEvent => ({
                boundary: event.boundary,
                correlationId: request.requestId as string,
                durationMs: event.durationMs,
                epochMs: event.epochMs,
                itemCount:
                    event.boundary === 'end'
                        ? (event.metadata?.itemCount ?? null)
                        : null,
                phase: event.phase,
            }));
        })
        .sort(compareEvents);
    if (!isDeepStrictEqual(captured, projected)) invalid();
}

function copyCaptureEvent(
    event: XtreamAttributionPhaseEvent
): WorkerBindablePhaseEvent {
    return {
        boundary: event.boundary,
        correlationId: event.correlationId,
        durationMs: event.durationMs,
        epochMs: event.epochMs,
        itemCount: event.itemCount,
        phase: event.phase,
    };
}

function compareEvents(
    left: WorkerBindablePhaseEvent,
    right: WorkerBindablePhaseEvent
): number {
    return eventKey(left).localeCompare(eventKey(right));
}

function eventKey(event: WorkerBindablePhaseEvent): string {
    return [
        event.correlationId,
        event.phase,
        event.boundary,
        event.epochMs,
        event.durationMs,
        event.itemCount,
    ].join('\0');
}

function snapshotOwnArray<T>(value: unknown): readonly T[] {
    if (!Array.isArray(value)) invalid();
    const descriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const length = descriptor?.value;
    if (
        !Number.isSafeInteger(length) ||
        Number(length) < 0 ||
        Number(length) > 512
    ) {
        invalid();
    }
    const result: T[] = [];
    for (let index = 0; index < Number(length); index += 1) {
        const entry = Reflect.getOwnPropertyDescriptor(value, String(index));
        if (!entry || !Object.prototype.hasOwnProperty.call(entry, 'value')) {
            invalid();
        }
        result[index] = entry.value as T;
    }
    return Object.freeze(result);
}

function invalid(): never {
    throw new Error('invalid Xtream persisted evidence binding');
}
