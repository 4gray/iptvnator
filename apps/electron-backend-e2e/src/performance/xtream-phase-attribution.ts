import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import {
    isExactRecord,
    isFiniteNonNegative,
    isPositiveSafeInteger,
    sameMaps,
    sameValues,
} from './xtream-exact-schema';
import { pairXtreamPhaseEvents } from './xtream-phase-event-pairing';
import {
    expectedXtreamIpc,
    expectedXtreamPhases,
    matchesXtreamPhaseItemCounts,
    XTREAM_ATTRIBUTION_PHASE,
    XTREAM_NORMALIZATION_PHASES,
    XTREAM_SQLITE_READ_PHASES,
    XTREAM_SQLITE_WRITE_PHASES,
    type XtreamInventoryExpectation,
    type XtreamPhaseSemanticType,
} from './xtream-phase-inventory';
import type {
    XtreamPhaseCategoryType,
    XtreamPhaseContentType,
    XtreamPhaseProviderAction,
} from './xtream-phase-semantic-source';
import { snapshotXtreamPhaseInput } from './xtream-own-array-snapshot';
import {
    assertXtreamPhaseTopology,
    type XtreamTopologyPhaseSpan,
} from './xtream-phase-topology';
import {
    hasDistinctMonotonicXtreamIpcProducerIdentities,
    xtreamIpcProducerNamespaceForMethod,
} from './xtream-ipc-producer-identity';

export { XTREAM_ATTRIBUTION_PHASE } from './xtream-phase-inventory';

export const XTREAM_PHASE_NA_REASON = {
    COMMIT_INCLUDED_IN_WRITE: 'included-in-sqlite-write-transaction-spans',
    NO_USER_DATA: 'no-user-data',
    NOT_INVOKED: 'not-invoked-by-scenario',
    SCHEMA_INDEXES_PRE_EXIST:
        'schema-indexes-pre-exist; operation-creates-none',
    SOURCES_SEARCH_HAS_NO_XTREAM_MARKER:
        'sources-search-does-not-publish-xtream-search-results',
} as const;

export interface XtreamAttributionPhaseEvent {
    readonly boundary: 'end' | 'start';
    readonly categoryType: XtreamPhaseCategoryType | null;
    readonly contentType: XtreamPhaseContentType | null;
    readonly correlationId: string;
    readonly durationMs: number | null;
    readonly epochMs: number;
    readonly itemCount: number | null;
    readonly phase: string;
    readonly providerAction: XtreamPhaseProviderAction | null;
    readonly semanticType: XtreamPhaseSemanticType | null;
}

export interface XtreamIpcAttributionSpan {
    readonly boundary: 'request' | 'response';
    readonly correlationId: string;
    readonly endEpochMs: number;
    readonly ipcCallId: number;
    readonly method: string;
    readonly outcome: 'error' | 'success';
    readonly sourceEpochMs: number;
    readonly startEpochMs: number;
}

export interface XtreamPhaseAttributionInput {
    readonly backgroundSearchMarkerObserved: boolean;
    readonly events: readonly XtreamAttributionPhaseEvent[];
    readonly ipcSpans: readonly XtreamIpcAttributionSpan[];
    readonly operationStartEpochMs: number;
    readonly scenarioId: XtreamScenarioId;
    readonly terminalEpochMs: number;
    readonly uiPaintEpochMs: number;
}

export interface XtreamPhaseAttribution {
    readonly angularRenderingMs: number;
    readonly backgroundSearchMarkerMs: null;
    readonly backgroundSearchMarkerReason:
        | typeof XTREAM_PHASE_NA_REASON.SOURCES_SEARCH_HAS_NO_XTREAM_MARKER
        | null;
    readonly dataAcquisitionMs: number;
    readonly deserializationMs: number;
    readonly indexesMs: null;
    readonly indexesReason: typeof XTREAM_PHASE_NA_REASON.SCHEMA_INDEXES_PRE_EXIST;
    readonly jsonParsingMs: number;
    readonly normalizationMs: number;
    readonly restoreUserDataMs: null;
    readonly restoreUserDataReason:
        | typeof XTREAM_PHASE_NA_REASON.NO_USER_DATA
        | typeof XTREAM_PHASE_NA_REASON.NOT_INVOKED;
    readonly serializationMs: number;
    readonly sqliteReadMs: number;
    readonly sqliteWriteMs: number;
    readonly storeUpdateMs: number;
    readonly structuredCloneAttribution: 'selected-ipc-proxy-includes-queueing-and-scheduling';
    readonly structuredCloneProxyMs: number;
    readonly totalMs: number;
    readonly transactionCommitMs: null;
    readonly transactionCommitReason: typeof XTREAM_PHASE_NA_REASON.COMMIT_INCLUDED_IN_WRITE;
}

const PHASE = XTREAM_ATTRIBUTION_PHASE;
type PhaseSpan = XtreamTopologyPhaseSpan;

export function attributeXtreamPhases(
    input: XtreamPhaseAttributionInput
): XtreamPhaseAttribution {
    try {
        input = snapshotXtreamPhaseInput(input);
        assertEnvelope(input);
        const spans = pairXtreamPhaseEvents(input);
        const expected = expectedXtreamPhases(input.scenarioId);
        assertInventory(spans, expected, input.scenarioId);
        assertMainPhases(spans);
        assertXtreamPhaseTopology(input.scenarioId, spans);
        const store = spans.filter(({ phase }) => phase.startsWith('store.'));
        const storeEnd = Math.max(...store.map(({ endEpochMs }) => endEpochMs));
        if (input.uiPaintEpochMs < storeEnd) invalid();
        if (
            input.scenarioId === 'xtream-background-ui' &&
            input.backgroundSearchMarkerObserved
        ) {
            throw new Error('unexpected background search marker');
        }
        const network = select(spans, PHASE.NETWORK_TOTAL);
        const json = select(spans, PHASE.JSON_TRANSFORM);
        const jsonById = new Map(
            json.map((span) => [span.correlationId, span])
        );
        const restores =
            input.scenarioId === 'xtream-refresh-large' ||
            input.scenarioId === 'xtream-background-ui';
        return {
            totalMs: input.terminalEpochMs - input.operationStartEpochMs,
            dataAcquisitionMs:
                sum(network) -
                sum(
                    network.map(({ correlationId }) => {
                        const nested = jsonById.get(correlationId);
                        if (!nested) invalid();
                        return nested;
                    })
                ),
            jsonParsingMs: sum(json),
            normalizationMs: sum(filter(spans, XTREAM_NORMALIZATION_PHASES)),
            serializationMs: sum(select(spans, PHASE.SERIALIZE_PLAYLIST)),
            deserializationMs: sum(select(spans, PHASE.DESERIALIZE_PLAYLIST)),
            structuredCloneProxyMs: assertIpcInventory(input),
            sqliteReadMs: sum(filter(spans, XTREAM_SQLITE_READ_PHASES)),
            sqliteWriteMs: sum(filter(spans, XTREAM_SQLITE_WRITE_PHASES)),
            storeUpdateMs: sum(store),
            angularRenderingMs: input.uiPaintEpochMs - storeEnd,
            indexesMs: null,
            indexesReason: XTREAM_PHASE_NA_REASON.SCHEMA_INDEXES_PRE_EXIST,
            transactionCommitMs: null,
            transactionCommitReason:
                XTREAM_PHASE_NA_REASON.COMMIT_INCLUDED_IN_WRITE,
            structuredCloneAttribution:
                'selected-ipc-proxy-includes-queueing-and-scheduling',
            restoreUserDataMs: null,
            restoreUserDataReason: restores
                ? XTREAM_PHASE_NA_REASON.NO_USER_DATA
                : XTREAM_PHASE_NA_REASON.NOT_INVOKED,
            backgroundSearchMarkerMs: null,
            backgroundSearchMarkerReason:
                input.scenarioId === 'xtream-background-ui'
                    ? XTREAM_PHASE_NA_REASON.SOURCES_SEARCH_HAS_NO_XTREAM_MARKER
                    : null,
        };
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'unexpected background search marker'
        ) {
            throw error;
        }
        throw new Error('invalid Xtream phase capture');
    }
}

function assertInventory(
    spans: readonly PhaseSpan[],
    expected: ReadonlyMap<string, XtreamInventoryExpectation>,
    scenarioId: XtreamScenarioId
): void {
    if (spans.length !== sumExpectations(expected)) invalid();
    for (const [phase, expectation] of expected) {
        const actual = select(spans, phase).sort(
            (left, right) => left.startEpochMs - right.startEpochMs
        );
        if (actual.length !== expectation.occurrences) invalid();
        if (
            expectation.itemCounts &&
            !matchesXtreamPhaseItemCounts(
                phase,
                actual.map(({ itemCount }) => itemCount),
                expectation.itemCounts
            )
        ) {
            invalid();
        }
    }
    if (spans.some(({ phase }) => !expected.has(phase))) invalid();
    if (scenarioId === 'xtream-cancel-import') {
        const counts = select(
            spans,
            PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS
        )
            .sort((left, right) => left.startEpochMs - right.startEpochMs)
            .map(({ itemCount }) => itemCount);
        if (
            !isFiniteNonNegative(counts[0]) ||
            counts[0] < 6_060 ||
            counts[0] >= 60_060 ||
            !sameValues(counts.slice(1), [20, 20])
        ) {
            invalid();
        }
    }
}

function assertMainPhases(spans: readonly PhaseSpan[]): void {
    const network = select(spans, PHASE.NETWORK_TOTAL);
    const json = new Map(
        select(spans, PHASE.JSON_TRANSFORM).map((span) => [
            span.correlationId,
            span,
        ])
    );
    const response = new Map(
        select(spans, PHASE.RESPONSE_READY).map((span) => [
            span.correlationId,
            span,
        ])
    );
    for (const span of network) {
        const nested = json.get(span.correlationId);
        const ready = response.get(span.correlationId);
        if (
            !nested ||
            !ready ||
            nested.semanticType !== span.semanticType ||
            ready.semanticType !== span.semanticType ||
            nested.startEpochMs < span.startEpochMs ||
            nested.endEpochMs > span.endEpochMs ||
            ready.startEpochMs < span.endEpochMs
        ) {
            invalid();
        }
    }
}

function assertIpcInventory(input: XtreamPhaseAttributionInput): number {
    const expected = expectedXtreamIpc(input.scenarioId);
    const groups = new Map<string, XtreamIpcAttributionSpan[]>();
    let total = 0;
    for (const span of input.ipcSpans) {
        if (
            !isExactRecord(span, [
                'boundary',
                'correlationId',
                'endEpochMs',
                'ipcCallId',
                'method',
                'outcome',
                'sourceEpochMs',
                'startEpochMs',
            ]) ||
            !['request', 'response'].includes(span.boundary) ||
            typeof span.correlationId !== 'string' ||
            span.correlationId.length === 0 ||
            typeof span.method !== 'string' ||
            span.method.length === 0 ||
            !['error', 'success'].includes(span.outcome) ||
            !isFiniteNonNegative(span.startEpochMs) ||
            !isFiniteNonNegative(span.endEpochMs) ||
            !isPositiveSafeInteger(span.ipcCallId) ||
            !isFiniteNonNegative(span.sourceEpochMs) ||
            span.sourceEpochMs < input.operationStartEpochMs ||
            span.sourceEpochMs > span.startEpochMs ||
            span.startEpochMs < input.operationStartEpochMs ||
            span.endEpochMs < span.startEpochMs ||
            span.endEpochMs > input.terminalEpochMs
        ) {
            invalid();
        }
        total += span.endEpochMs - span.startEpochMs;
        groups.set(span.correlationId, [
            ...(groups.get(span.correlationId) ?? []),
            span,
        ]);
    }
    const actual = new Map<string, { error: number; success: number }>();
    const producerCalls: XtreamIpcAttributionSpan[] = [];
    for (const spans of groups.values()) {
        const request = spans.find(({ boundary }) => boundary === 'request');
        const response = spans.find(({ boundary }) => boundary === 'response');
        if (
            spans.length !== 2 ||
            !request ||
            !response ||
            request.method !== response.method ||
            request.outcome !== response.outcome ||
            request.ipcCallId !== response.ipcCallId ||
            request.sourceEpochMs !== response.sourceEpochMs ||
            request.endEpochMs > response.startEpochMs
        ) {
            invalid();
        }
        producerCalls.push(request);
        const counts = actual.get(request.method) ?? { error: 0, success: 0 };
        counts[request.outcome] += 1;
        actual.set(request.method, counts);
    }
    const producerIdentities = producerCalls.map(
        ({ ipcCallId, method, sourceEpochMs }) => {
            const namespace = xtreamIpcProducerNamespaceForMethod(method);
            if (namespace === null) invalid();
            return { ipcCallId, namespace, sourceEpochMs };
        }
    );
    if (!hasDistinctMonotonicXtreamIpcProducerIdentities(producerIdentities))
        invalid();
    if (!sameMaps(actual, expected)) invalid();
    return total;
}

function assertEnvelope(input: XtreamPhaseAttributionInput): void {
    if (
        !isFiniteNonNegative(input.operationStartEpochMs) ||
        !isFiniteNonNegative(input.terminalEpochMs) ||
        !isFiniteNonNegative(input.uiPaintEpochMs) ||
        !Object.values(XTREAM_SCENARIO_ID).includes(input.scenarioId) ||
        typeof input.backgroundSearchMarkerObserved !== 'boolean' ||
        input.terminalEpochMs < input.operationStartEpochMs ||
        input.uiPaintEpochMs < input.operationStartEpochMs ||
        input.uiPaintEpochMs > input.terminalEpochMs
    ) {
        invalid();
    }
}

function filter(spans: readonly PhaseSpan[], phases: ReadonlySet<string>) {
    return spans.filter(({ phase }) => phases.has(phase));
}

function select(spans: readonly PhaseSpan[], phase: string): PhaseSpan[] {
    return spans.filter((span) => span.phase === phase);
}

function sum(spans: readonly PhaseSpan[]): number {
    return spans.reduce((total, span) => total + span.durationMs, 0);
}

function sumExpectations(
    values: ReadonlyMap<string, XtreamInventoryExpectation>
) {
    return [...values.values()].reduce(
        (total, { occurrences }) => total + occurrences,
        0
    );
}

function invalid(): never {
    throw new Error('invalid');
}
