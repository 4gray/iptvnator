import assert from 'node:assert/strict';

import {
    type XtreamAttributionPhaseEvent,
    XTREAM_ATTRIBUTION_PHASE as PHASE,
} from './xtream-phase-attribution';
import {
    XTREAM_PHASE_SEMANTIC_TYPE as SEMANTIC,
    type XtreamPhaseSemanticType,
} from './xtream-phase-inventory';
import { xtreamDataSemanticSource } from './xtream-phase-semantic-source';

export function swapProviderTimelines(
    events: readonly XtreamAttributionPhaseEvent[],
    leftId: string,
    rightId: string
): XtreamAttributionPhaseEvent[] {
    const epochs = new Map(
        events
            .filter(
                ({ correlationId }) =>
                    correlationId === leftId || correlationId === rightId
            )
            .map(({ boundary, correlationId, epochMs, phase }) => [
                `${correlationId}\0${phase}\0${boundary}`,
                epochMs,
            ])
    );
    return events.map((event) => {
        if (event.correlationId !== leftId && event.correlationId !== rightId) {
            return event;
        }
        const sourceId = event.correlationId === leftId ? rightId : leftId;
        const epochMs = epochs.get(
            `${sourceId}\0${event.phase}\0${event.boundary}`
        );
        assert.notEqual(epochMs, undefined);
        return { ...event, epochMs: Number(epochMs) };
    });
}

export function phaseEpoch(
    events: readonly XtreamAttributionPhaseEvent[],
    phase: string,
    boundary: 'end' | 'start'
): number {
    const event = events.find(
        (candidate) =>
            candidate.phase === phase && candidate.boundary === boundary
    );
    assert.ok(event);
    return event.epochMs;
}

export function relabelInterleavedCategoryRequests(
    events: readonly XtreamAttributionPhaseEvent[]
): XtreamAttributionPhaseEvent[] {
    const layout = new Map<
        string,
        { semanticType: XtreamPhaseSemanticType; startEpochMs: number }
    >([
        [
            `category-save-1\0${PHASE.NORMALIZE_CATEGORIES}`,
            { semanticType: SEMANTIC.VOD_CATEGORIES, startEpochMs: 148 },
        ],
        [
            `category-save-2\0${PHASE.NORMALIZE_CATEGORIES}`,
            { semanticType: SEMANTIC.SERIES_CATEGORIES, startEpochMs: 150 },
        ],
        [
            `category-save-1\0${PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS}`,
            { semanticType: SEMANTIC.SERIES_CATEGORIES, startEpochMs: 152 },
        ],
        [
            `category-save-2\0${PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS}`,
            { semanticType: SEMANTIC.VOD_CATEGORIES, startEpochMs: 154 },
        ],
        [
            `category-read-2-post\0${PHASE.SQLITE_CATEGORIES_READ}`,
            { semanticType: SEMANTIC.SERIES_CATEGORIES, startEpochMs: 156 },
        ],
        [
            `category-read-1-post\0${PHASE.SQLITE_CATEGORIES_READ}`,
            { semanticType: SEMANTIC.VOD_CATEGORIES, startEpochMs: 158 },
        ],
    ]);
    return events.map((event) => {
        const replacement = layout.get(
            `${event.correlationId}\0${event.phase}`
        );
        if (!replacement) return event;
        const source = xtreamDataSemanticSource(replacement.semanticType);
        return {
            ...event,
            ...source,
            epochMs:
                replacement.startEpochMs +
                (event.boundary === 'end' ? Number(event.durationMs) : 0),
            semanticType: replacement.semanticType,
        };
    });
}
