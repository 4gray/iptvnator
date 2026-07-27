import {
    isExactRecord,
    isFiniteNonNegative,
    isSafeNonNegativeInteger,
} from './xtream-exact-schema';
import type {
    XtreamAttributionPhaseEvent,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import { fitsPerformanceDurationEnvelope } from './performance-phase-duration-envelope';
import { XTREAM_ATTRIBUTION_PHASE } from './xtream-phase-inventory';
import { semanticTypeFromXtreamPhaseSource } from './xtream-phase-semantic-source';
import type { XtreamTopologyPhaseSpan } from './xtream-phase-topology';

const PHASES = new Set<string>(Object.values(XTREAM_ATTRIBUTION_PHASE));

export function pairXtreamPhaseEvents(
    input: XtreamPhaseAttributionInput
): readonly XtreamTopologyPhaseSpan[] {
    const groups = new Map<string, XtreamAttributionPhaseEvent[]>();
    for (const event of input.events) {
        assertCanonicalEvent(event);
        const key = `${event.phase}\0${event.correlationId}`;
        groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.values()].map((events) => pairGroup(input, events));
}

function assertCanonicalEvent(event: XtreamAttributionPhaseEvent): void {
    if (
        !isExactRecord(event, [
            'boundary',
            'categoryType',
            'contentType',
            'correlationId',
            'durationMs',
            'epochMs',
            'itemCount',
            'phase',
            'providerAction',
            'semanticType',
        ]) ||
        !PHASES.has(event.phase) ||
        !['start', 'end'].includes(event.boundary) ||
        typeof event.correlationId !== 'string' ||
        event.correlationId.length === 0 ||
        semanticTypeFromXtreamPhaseSource(event) !== event.semanticType ||
        !isFiniteNonNegative(event.epochMs)
    ) {
        invalid();
    }
}

function pairGroup(
    input: XtreamPhaseAttributionInput,
    events: readonly XtreamAttributionPhaseEvent[]
): XtreamTopologyPhaseSpan {
    const [start, end] = events;
    if (
        events.length !== 2 ||
        !start ||
        !end ||
        start.boundary !== 'start' ||
        end.boundary !== 'end' ||
        start.durationMs !== null ||
        start.itemCount !== null ||
        start.providerAction !== end.providerAction ||
        start.categoryType !== end.categoryType ||
        start.contentType !== end.contentType ||
        start.semanticType !== end.semanticType ||
        !isFiniteNonNegative(end.durationMs) ||
        (end.itemCount !== null && !isSafeNonNegativeInteger(end.itemCount)) ||
        start.epochMs < input.operationStartEpochMs ||
        end.epochMs < start.epochMs ||
        end.epochMs > input.terminalEpochMs ||
        !fitsPerformanceDurationEnvelope(
            end.durationMs,
            input.operationStartEpochMs,
            input.terminalEpochMs
        )
    ) {
        invalid();
    }
    return {
        categoryType: start.categoryType,
        contentType: start.contentType,
        correlationId: start.correlationId,
        durationMs: end.durationMs,
        endEpochMs: end.epochMs,
        itemCount: end.itemCount,
        phase: start.phase,
        providerAction: start.providerAction,
        semanticType: start.semanticType,
        startEpochMs: start.epochMs,
    };
}

function invalid(): never {
    throw new Error('invalid Xtream phase event pairing');
}
