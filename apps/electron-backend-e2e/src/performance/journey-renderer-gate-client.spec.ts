import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertJourneyRendererGate,
    JOURNEY_RENDERER_GATE_KEY,
    type JourneyRendererGateState,
} from '../journeys/journey-renderer-gate-client';

function gate(
    overrides: Partial<JourneyRendererGateState> = {}
): JourneyRendererGateState {
    return {
        blankLoadedEpochMs: 1_050,
        errors: [],
        gatedEpochMs: 1_020,
        gatedMethod: 'loadFile',
        passThroughLoads: 0,
        releasedEpochMs: 1_150,
        timedOut: false,
        ...overrides,
    };
}

test('the client and the hook agree on the global key', () => {
    assert.equal(JOURNEY_RENDERER_GATE_KEY, '__iptvnatorJourneyGate');
});

test('accepts a gate that held the load until the test released it', () => {
    assert.equal(
        assertJourneyRendererGate(gate(), 1_200).releasedEpochMs,
        1_150
    );
});

test('rejects gates that cannot prove the probe preceded the document', () => {
    assert.throws(
        () => assertJourneyRendererGate(gate({ timedOut: true }), 1_200),
        /timed-out/
    );
    assert.throws(
        () =>
            assertJourneyRendererGate(
                gate({ errors: ['blank-failed'] }),
                1_200
            ),
        /errors: blank-failed/
    );
    assert.throws(
        () => assertJourneyRendererGate(gate({ releasedEpochMs: null }), 1_200),
        /incomplete/
    );
    assert.throws(
        () => assertJourneyRendererGate(gate({ passThroughLoads: 1 }), 1_200),
        /extra-loads-1/
    );
    assert.throws(
        () => assertJourneyRendererGate(gate(), 1_100),
        /probe-before-release/
    );
});
