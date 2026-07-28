import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PERFORMANCE_ITERATION_KIND } from './m3u-refresh-cancellation-contract';
import {
    assertSyntheticM3uImportUrl,
    createM3uImportIterationDefinitions,
    listM3uImportScenarios,
    M3U_IMPORT_SCENARIO_ID,
} from './m3u-import-benchmark-contract';

describe('formal M3U import benchmark contract', () => {
    it('defines the exact 10k, 50k, and 100k synthetic scenarios', () => {
        assert.deepEqual(listM3uImportScenarios(), [
            {
                channelCount: 10_000,
                id: M3U_IMPORT_SCENARIO_ID.IMPORT_10K,
            },
            {
                channelCount: 50_000,
                id: M3U_IMPORT_SCENARIO_ID.IMPORT_50K,
            },
            {
                channelCount: 100_000,
                id: M3U_IMPORT_SCENARIO_ID.IMPORT_100K,
            },
        ]);
    });

    it('schedules one warm-up, five measured runs, and one diagnostic per size', () => {
        const definitions = createM3uImportIterationDefinitions(false);

        assert.equal(definitions.length, 21);
        for (const scenario of listM3uImportScenarios()) {
            const scenarioRuns = definitions.filter(
                (definition) => definition.scenarioId === scenario.id
            );
            assert.deepEqual(
                scenarioRuns.map(({ kind, runId }) => ({ kind, runId })),
                [
                    {
                        kind: PERFORMANCE_ITERATION_KIND.WARMUP,
                        runId: 'warmup-01',
                    },
                    ...Array.from({ length: 5 }, (_, index) => ({
                        kind: PERFORMANCE_ITERATION_KIND.MEASURED,
                        runId: `run-${String(index + 1).padStart(2, '0')}`,
                    })),
                    {
                        kind: PERFORMANCE_ITERATION_KIND.DIAGNOSTIC,
                        runId: 'diagnostic',
                    },
                ]
            );
            assert.ok(
                scenarioRuns.every(
                    (definition) =>
                        definition.channelCount === scenario.channelCount
                )
            );
        }
    });

    it('keeps fixture sizes unchanged while smoke mode reduces measured runs to one', () => {
        const definitions = createM3uImportIterationDefinitions(true);

        assert.equal(definitions.length, 9);
        for (const scenario of listM3uImportScenarios()) {
            assert.deepEqual(
                definitions
                    .filter(
                        (definition) => definition.scenarioId === scenario.id
                    )
                    .map(({ kind, runId }) => ({ kind, runId })),
                [
                    {
                        kind: PERFORMANCE_ITERATION_KIND.WARMUP,
                        runId: 'warmup-01',
                    },
                    {
                        kind: PERFORMANCE_ITERATION_KIND.MEASURED,
                        runId: 'run-01',
                    },
                    {
                        kind: PERFORMANCE_ITERATION_KIND.DIAGNOSTIC,
                        runId: 'diagnostic',
                    },
                ]
            );
        }
    });

    it('accepts only the exact credential-free loopback fixture URL', () => {
        assert.doesNotThrow(() =>
            assertSyntheticM3uImportUrl(
                'http://127.0.0.1:43210/synthetic-performance.m3u'
            )
        );

        for (const unsafe of [
            'https://127.0.0.1:43210/synthetic-performance.m3u',
            'http://localhost:43210/synthetic-performance.m3u',
            'http://127.0.0.1/synthetic-performance.m3u',
            'http://user:pass@127.0.0.1:43210/synthetic-performance.m3u',
            'http://127.0.0.1:43210/other.m3u',
            'http://127.0.0.1:43210/synthetic-performance.m3u?token=secret',
            'http://127.0.0.1:43210/synthetic-performance.m3u#fragment',
        ]) {
            assert.throws(
                () => assertSyntheticM3uImportUrl(unsafe),
                /exact synthetic HTTP loopback URL/
            );
        }
    });
});
