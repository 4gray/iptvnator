import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
    type XtreamIterationDefinition,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { iteration } from './xtream-benchmark-report.fixtures';
import { assertXtreamIterationResult } from './xtream-iteration-validity';
import type {
    XtreamCancellationEvidence,
    XtreamRawIterationResult,
} from './xtream-summary-contract';

describe('Xtream raw descriptor integrity', () => {
    it('rejects symbol and non-enumerable top-level extras', () => {
        for (const key of [Symbol('extra'), 'hiddenExtra'] as const) {
            const raw = createIteration();
            Object.defineProperty(raw, key, { value: true });

            assert.throws(
                () => assertXtreamIterationResult(raw),
                /invalid Xtream iteration/
            );
        }
    });

    it('rejects symbol extras on cancellation records', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const evidence = cancellationEvidence(raw);
        Object.defineProperty(evidence.timeline[0], Symbol('extra'), {
            value: true,
        });

        assert.throws(
            () => assertXtreamIterationResult(raw),
            /invalid Xtream iteration/
        );
    });

    it('rejects a cancellation timeline accessor without invoking it', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const evidence = cancellationEvidence(raw);
        let invocations = 0;
        const accessorEvidence = {};
        Object.defineProperty(accessorEvidence, 'timeline', {
            enumerable: true,
            get() {
                invocations += 1;
                return evidence.timeline;
            },
        });

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    cancellationEvidence:
                        accessorEvidence as XtreamCancellationEvidence,
                }),
            /invalid Xtream iteration/
        );
        assert.equal(invocations, 0);
    });

    it('rejects cancellation record accessors without invoking them', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const evidence = cancellationEvidence(raw);
        const original = evidence.timeline[0];
        let invocations = 0;
        const accessorRecord = { ...original };
        Object.defineProperty(accessorRecord, 'epochMs', {
            enumerable: true,
            get() {
                invocations += 1;
                return original.epochMs;
            },
        });

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    cancellationEvidence: {
                        timeline: [
                            accessorRecord,
                            ...evidence.timeline.slice(1),
                        ],
                    },
                }),
            /invalid Xtream iteration/
        );
        assert.equal(invocations, 0);
    });

    it('rejects every own cancellation timeline key beyond dense indices and length', () => {
        for (const extraKey of [
            Symbol('extra'),
            'hiddenExtra',
            'map',
        ] as const) {
            const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
            const evidence = cancellationEvidence(raw);
            const timeline = [...evidence.timeline];
            Object.defineProperty(timeline, extraKey, {
                value:
                    extraKey === 'map'
                        ? Array.prototype.map.bind(timeline)
                        : true,
            });

            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...raw,
                        cancellationEvidence: { timeline },
                    }),
                /invalid Xtream iteration/
            );
        }
    });
});

function cancellationEvidence(
    raw: XtreamRawIterationResult
): XtreamCancellationEvidence {
    assert.ok(raw.cancellationEvidence);
    return raw.cancellationEvidence;
}

function createIteration(
    scenarioId: XtreamScenarioId = XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
): XtreamRawIterationResult {
    const definition: XtreamIterationDefinition = {
        eligibleForComparison: true,
        kind: XTREAM_ITERATION_KIND.MEASURED,
        runId: 'run-01',
        scenarioId,
    };
    return iteration(definition, 1);
}
