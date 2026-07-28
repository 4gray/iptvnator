import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { attributeXtreamPhases } from './xtream-phase-attribution';
import { scenarioCapture } from './xtream-phase-attribution.fixtures';
import {
    expectedXtreamIpc,
    expectedXtreamPhases,
    XTREAM_ATTRIBUTION_PHASE as PHASE,
    XTREAM_PHASE_SEMANTIC_TYPE as SEMANTIC,
} from './xtream-phase-inventory';

const EXPECTED_PROVIDER_CALLS: Readonly<Record<XtreamScenarioId, number>> = {
    [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE]: 8,
    [XTREAM_SCENARIO_ID.REFRESH_LARGE]: 8,
    [XTREAM_SCENARIO_ID.DELETE_LARGE]: 0,
    [XTREAM_SCENARIO_ID.CANCEL_IMPORT]: 6,
    [XTREAM_SCENARIO_ID.BACKGROUND_UI]: 8,
};

const EXPECTED_ACCOUNT_CALLS: Readonly<Record<XtreamScenarioId, number>> = {
    [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE]: 2,
    [XTREAM_SCENARIO_ID.REFRESH_LARGE]: 2,
    [XTREAM_SCENARIO_ID.DELETE_LARGE]: 0,
    [XTREAM_SCENARIO_ID.CANCEL_IMPORT]: 2,
    [XTREAM_SCENARIO_ID.BACKGROUND_UI]: 2,
};

describe('Xtream account phase inventory', () => {
    it('counts every scenario-specific provider IPC and phase lifecycle', () => {
        for (const scenarioId of Object.values(XTREAM_SCENARIO_ID)) {
            const providerCalls = EXPECTED_PROVIDER_CALLS[scenarioId];
            assert.equal(
                expectedXtreamPhases(scenarioId).get(PHASE.NETWORK_TOTAL)
                    ?.occurrences,
                providerCalls
            );
            assert.equal(
                expectedXtreamIpc(scenarioId).get('xtreamRequest')?.success ??
                    0,
                providerCalls
            );
        }
    });

    it('fixtures contain the exact account lifecycle count and remain valid', () => {
        for (const scenarioId of Object.values(XTREAM_SCENARIO_ID)) {
            const capture = scenarioCapture(scenarioId);
            const accounts = capture.events.filter(
                ({ boundary, phase, semanticType }) =>
                    boundary === 'start' &&
                    phase === PHASE.NETWORK_TOTAL &&
                    semanticType === SEMANTIC.ACCOUNT
            );
            assert.equal(accounts.length, EXPECTED_ACCOUNT_CALLS[scenarioId]);
            assert.doesNotThrow(() => attributeXtreamPhases(capture));
        }
    });

    it('allows the two independent fresh-add account phases to overlap', () => {
        const capture = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const events = capture.events.map((event) =>
            event.correlationId === 'provider-account-route'
                ? { ...event, epochMs: event.epochMs - 6.5 }
                : event
        );

        assert.doesNotThrow(() =>
            attributeXtreamPhases({ ...capture, events })
        );
    });
});
