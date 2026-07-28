import type {
    XtreamAttributionPhaseEvent,
    XtreamIpcAttributionSpan,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import type { XtreamScenarioId } from './xtream-benchmark-contract';
import {
    XTREAM_ATTRIBUTION_PHASE as PHASE,
    type XtreamPhaseSemanticType,
} from './xtream-phase-inventory';
import {
    semanticTypeFromXtreamPhaseSource,
    xtreamDataSemanticSource,
    xtreamProviderSemanticSource,
    type XtreamPhaseSemanticSource,
} from './xtream-phase-semantic-source';
import {
    XTREAM_IPC_PRODUCER_NAMESPACE,
    xtreamIpcProducerNamespaceForMethod,
} from './xtream-ipc-producer-identity';

export interface XtreamFixtureInventoryBuilder {
    readonly cursor: number;
    add(
        phase: string,
        id: string,
        itemCount: number | null,
        semanticType?: XtreamPhaseSemanticType
    ): void;
    addAt(
        phase: string,
        id: string,
        startEpochMs: number,
        durationMs: number,
        itemCount: number | null,
        semanticType?: XtreamPhaseSemanticType
    ): void;
    addProvider(id: string, semanticType: XtreamPhaseSemanticType): void;
    capture(
        scenarioId: XtreamScenarioId,
        ipcSpans: readonly XtreamIpcAttributionSpan[],
        uiPaintEpochMs?: number
    ): XtreamPhaseAttributionInput;
}

export function createXtreamFixtureInventoryBuilder(): XtreamFixtureInventoryBuilder {
    let cursor = 104;
    const events: XtreamAttributionPhaseEvent[] = [];
    return {
        get cursor() {
            return cursor;
        },
        add(phase, id, itemCount, semanticType) {
            events.push(
                ...pair(
                    phase,
                    id,
                    cursor,
                    1,
                    itemCount,
                    xtreamDataSemanticSource(semanticType ?? null)
                )
            );
            cursor += 2;
        },
        addAt(phase, id, startEpochMs, durationMs, itemCount, semanticType) {
            events.push(
                ...pair(
                    phase,
                    id,
                    startEpochMs,
                    durationMs,
                    itemCount,
                    xtreamDataSemanticSource(semanticType ?? null)
                )
            );
            cursor = Math.max(cursor, startEpochMs + durationMs + 1);
        },
        addProvider(id, semanticType) {
            const source = xtreamProviderSemanticSource(semanticType);
            events.push(...pair(PHASE.NETWORK_TOTAL, id, cursor, 4, 1, source));
            events.push(
                ...pair(PHASE.JSON_TRANSFORM, id, cursor + 1, 1, 1, source)
            );
            events.push(
                ...pair(PHASE.RESPONSE_READY, id, cursor + 5, 1, 1, source)
            );
            cursor += 7;
        },
        capture(scenarioId, ipcSpans, paint = cursor + 2) {
            return {
                backgroundSearchMarkerObserved: false,
                events,
                ipcSpans,
                operationStartEpochMs: 100,
                scenarioId,
                terminalEpochMs: cursor + 5,
                uiPaintEpochMs: paint,
            };
        },
    };
}

export function createXtreamFixtureIpcInventory(
    counts: Readonly<Record<string, number>>
): XtreamIpcAttributionSpan[] {
    const spans: XtreamIpcAttributionSpan[] = [];
    const nextIpcCallId = new Map(
        Object.values(XTREAM_IPC_PRODUCER_NAMESPACE).map((namespace) => [
            namespace,
            100,
        ])
    );
    for (const [method, count] of Object.entries(counts)) {
        const namespace = xtreamIpcProducerNamespaceForMethod(method);
        if (namespace === null) {
            throw new Error('invalid fixture IPC producer method');
        }
        for (let index = 0; index < Math.abs(count); index += 1) {
            const ipcCallId = Number(nextIpcCallId.get(namespace)) + 1;
            nextIpcCallId.set(namespace, ipcCallId);
            const correlationId = `${method}-${index}`;
            const outcome = count < 0 ? 'error' : 'success';
            spans.push(
                {
                    boundary: 'request',
                    correlationId,
                    endEpochMs: 101.25,
                    ipcCallId,
                    method,
                    outcome,
                    sourceEpochMs: 100.5,
                    startEpochMs: 101,
                },
                {
                    boundary: 'response',
                    correlationId,
                    endEpochMs: 101.75,
                    ipcCallId,
                    method,
                    outcome,
                    sourceEpochMs: 100.5,
                    startEpochMs: 101.5,
                }
            );
        }
    }
    return spans;
}

export function pair(
    phase: string,
    correlationId: string,
    startEpochMs: number,
    durationMs: number,
    itemCount: number | null,
    source: XtreamPhaseSemanticSource = xtreamDataSemanticSource(null)
): XtreamAttributionPhaseEvent[] {
    const semanticType = semanticTypeFromXtreamPhaseSource(source);
    if (semanticType === undefined) {
        throw new Error('invalid fixture semantic source');
    }
    return [
        {
            boundary: 'start',
            categoryType: source.categoryType,
            contentType: source.contentType,
            correlationId,
            durationMs: null,
            epochMs: startEpochMs,
            itemCount: null,
            phase,
            providerAction: source.providerAction,
            semanticType,
        },
        {
            boundary: 'end',
            categoryType: source.categoryType,
            contentType: source.contentType,
            correlationId,
            durationMs,
            epochMs: startEpochMs + durationMs,
            itemCount,
            phase,
            providerAction: source.providerAction,
            semanticType,
        },
    ];
}
