/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { XTREAM_MAIN_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { pairXtreamPhaseEvents } from './xtream-phase-event-pairing';
import type {
    XtreamAttributionPhaseEvent,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';

test('accepts producer-shaped main output when separately read clocks disagree on the phase span', () => {
    const events = [event('start', null, 101), event('end', 1.6115, 102)];
    const paired = pairXtreamPhaseEvents(input(events));
    assert.equal(paired[0]?.durationMs, 1.6115);
    assert.equal(
        Number(paired[0]?.endEpochMs) - Number(paired[0]?.startEpochMs),
        1
    );
});

test('rejects a main phase duration outside the operation envelope', () => {
    const events: XtreamAttributionPhaseEvent[] = [
        event('start', null, 101),
        event('end', 999, 102),
    ];

    assert.throws(
        () => pairXtreamPhaseEvents(input(events)),
        /invalid Xtream phase event pairing/
    );
});

function event(
    boundary: 'end' | 'start',
    durationMs: number | null,
    epochMs: number
): XtreamAttributionPhaseEvent {
    return {
        boundary,
        categoryType: null,
        contentType: null,
        correlationId: 'xtream-mabc1000-1',
        durationMs,
        epochMs,
        itemCount: null,
        phase: XTREAM_MAIN_PERFORMANCE_PHASE.CANCEL_SESSION,
        providerAction: null,
        semanticType: null,
    };
}

function input(
    events: readonly XtreamAttributionPhaseEvent[],
    scenarioId: XtreamScenarioId = XTREAM_SCENARIO_ID.CANCEL_IMPORT
): XtreamPhaseAttributionInput {
    return {
        backgroundSearchMarkerObserved: false,
        events,
        ipcSpans: [],
        operationStartEpochMs: 100,
        scenarioId,
        terminalEpochMs: 120,
        uiPaintEpochMs: 120,
    };
}
