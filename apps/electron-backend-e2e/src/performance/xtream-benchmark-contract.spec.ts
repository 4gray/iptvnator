import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    assertXtreamArtifactRedacted,
    assertXtreamControlReadyAfterObservationReset,
    assertXtreamControlStateForScenario,
    assertXtreamManifest,
    assertXtreamManifestIdentity,
    assertXtreamMockOrigin,
    createXtreamIterationDefinitions,
    listXtreamBenchmarkScenarios,
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
    type XtreamControlState,
    type XtreamPerformanceManifest,
} from './xtream-benchmark-contract';

const MANIFEST: XtreamPerformanceManifest = {
    epoch: 1,
    scenario: 'performance-100k',
    seed: 91_001,
    counts: {
        categories: { live: 60, vod: 20, series: 20, total: 100 },
        items: {
            live: 60_000,
            vod: 20_000,
            series: 20_000,
            total: 100_000,
        },
    },
    bytes: 12_345_678,
    catalogSha256:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('Xtream benchmark contract', () => {
    it('defines exactly the five requested scenarios', () => {
        assert.deepEqual(
            listXtreamBenchmarkScenarios().map(({ id }) => id),
            [
                XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
                XTREAM_SCENARIO_ID.REFRESH_LARGE,
                XTREAM_SCENARIO_ID.DELETE_LARGE,
                XTREAM_SCENARIO_ID.CANCEL_IMPORT,
                XTREAM_SCENARIO_ID.BACKGROUND_UI,
            ]
        );
    });

    it('schedules warm-up, five comparable measurements, and one diagnostic', () => {
        const definitions = createXtreamIterationDefinitions(false);

        assert.equal(definitions.length, 35);
        for (const { id } of listXtreamBenchmarkScenarios()) {
            const runs = definitions.filter(
                (definition) => definition.scenarioId === id
            );
            assert.deepEqual(
                runs.map(({ eligibleForComparison, kind, runId }) => ({
                    eligibleForComparison,
                    kind,
                    runId,
                })),
                [
                    {
                        eligibleForComparison: false,
                        kind: XTREAM_ITERATION_KIND.WARMUP,
                        runId: 'warmup-01',
                    },
                    ...Array.from({ length: 5 }, (_, index) => ({
                        eligibleForComparison: true,
                        kind: XTREAM_ITERATION_KIND.MEASURED,
                        runId: `run-${String(index + 1).padStart(2, '0')}`,
                    })),
                    {
                        eligibleForComparison: false,
                        kind: XTREAM_ITERATION_KIND.DIAGNOSTIC,
                        runId: 'diagnostic',
                    },
                ]
            );
        }
    });

    it('keeps smoke measurements ineligible for formal comparison', () => {
        const definitions = createXtreamIterationDefinitions(true);

        assert.equal(definitions.length, 15);
        assert.ok(
            definitions.every((definition) => !definition.eligibleForComparison)
        );
        for (const { id } of listXtreamBenchmarkScenarios()) {
            assert.deepEqual(
                definitions
                    .filter((definition) => definition.scenarioId === id)
                    .map(({ kind, runId }) => ({ kind, runId })),
                [
                    {
                        kind: XTREAM_ITERATION_KIND.WARMUP,
                        runId: 'warmup-01',
                    },
                    {
                        kind: XTREAM_ITERATION_KIND.MEASURED,
                        runId: 'run-01',
                    },
                    {
                        kind: XTREAM_ITERATION_KIND.DIAGNOSTIC,
                        runId: 'diagnostic',
                    },
                ]
            );
        }
    });

    it('accepts only an exact credential-free HTTP loopback origin', () => {
        assert.doesNotThrow(() =>
            assertXtreamMockOrigin('http://127.0.0.1:43123')
        );

        for (const unsafe of [
            'https://127.0.0.1:43123',
            'http://localhost:43123',
            'http://127.0.0.1',
            'http://127.0.0.1:43123/',
            'http://user:pass@127.0.0.1:43123',
            'http://127.0.0.1:43123/player_api.php',
            'http://127.0.0.1:43123?token=secret',
            'http://127.0.0.1:43123#fragment',
        ]) {
            assert.throws(
                () => assertXtreamMockOrigin(unsafe),
                /exact Xtream HTTP loopback origin/
            );
        }
    });

    it('rejects unexpected fixture names, counts, hashes, and identity drift', () => {
        assert.doesNotThrow(() => assertXtreamManifest(MANIFEST));

        for (const invalid of [
            { ...MANIFEST, scenario: 'provider-data' },
            { ...MANIFEST, seed: 42 },
            {
                ...MANIFEST,
                counts: {
                    ...MANIFEST.counts,
                    items: { ...MANIFEST.counts.items, total: 99_999 },
                },
            },
            { ...MANIFEST, catalogSha256: 'not-a-hash' },
            { ...MANIFEST, username: 'performance' },
        ]) {
            assert.throws(
                () => assertXtreamManifest(invalid),
                /invalid Xtream performance manifest/
            );
        }

        assert.doesNotThrow(() =>
            assertXtreamManifestIdentity(MANIFEST, {
                ...MANIFEST,
                epoch: 2,
            })
        );
        assert.throws(
            () =>
                assertXtreamManifestIdentity(MANIFEST, {
                    ...MANIFEST,
                    epoch: 2,
                    bytes: MANIFEST.bytes + 1,
                }),
            /fixture identity changed/
        );
    });

    it('requires a clean, same-epoch pre-trigger state after observation reset', () => {
        const ready = controlState([]);
        assert.doesNotThrow(() =>
            assertXtreamControlReadyAfterObservationReset(ready, MANIFEST)
        );

        for (const invalid of [
            { ...ready, epoch: 2 },
            { ...ready, rules: [{ kind: 'barrier' }] },
            { ...ready, heldCount: 1, heldIds: ['leftover'] },
            controlState([['get_account_info', 'all', 1]]),
        ]) {
            assert.throws(
                () =>
                    assertXtreamControlReadyAfterObservationReset(
                        invalid,
                        MANIFEST
                    ),
                /invalid Xtream mock readiness/
            );
        }
    });

    it('allows category requests to arrive in any parallel order', () => {
        assert.doesNotThrow(() =>
            assertXtreamControlStateForScenario(
                XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
                controlState(
                    [
                        ['get_account_info', 'all', 1],
                        ['get_series_categories', 'all', 2],
                        ['get_vod_categories', 'all', 3],
                        ['get_live_categories', 'all', 4],
                        ['get_live_streams', 'all', 5],
                        ['get_vod_streams', 'all', 6],
                        ['get_series', 'all', 7],
                    ],
                    2
                ),
                MANIFEST
            )
        );
    });

    it('fails closed on action drift, proxy traffic, residue, and ordering drift', () => {
        const cases: XtreamControlState[] = [
            controlState(fullActions().slice(0, -1), 2),
            controlState([...fullActions(), ['get_vod_info', 'all', 8]], 2),
            {
                ...controlState(fullActions(), 2),
                occurrences: controlState(fullActions(), 2).occurrences.map(
                    (entry, index) =>
                        index === 0 ? { ...entry, transport: 'proxy' } : entry
                ),
            },
            {
                ...controlState(fullActions(), 2),
                rules: [{ kind: 'delay' }],
            },
            {
                ...controlState(fullActions(), 2),
                heldCount: 1,
                heldIds: ['leftover'],
            },
            controlState(
                [
                    ['get_account_info', 'all', 1],
                    ['get_live_streams', 'all', 2],
                    ['get_live_categories', 'all', 3],
                    ['get_vod_categories', 'all', 4],
                    ['get_series_categories', 'all', 5],
                    ['get_vod_streams', 'all', 6],
                    ['get_series', 'all', 7],
                ],
                2
            ),
        ];

        for (const invalid of cases) {
            assert.throws(
                () =>
                    assertXtreamControlStateForScenario(
                        XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
                        invalid,
                        MANIFEST
                    ),
                /invalid Xtream mock observations/
            );
        }
    });

    it('rejects credential keys and secret values from persisted artifacts', () => {
        assert.doesNotThrow(() =>
            assertXtreamArtifactRedacted({
                fixture: {
                    bytes: MANIFEST.bytes,
                    catalogSha256: MANIFEST.catalogSha256,
                },
            })
        );
        for (const unsafe of [
            { username: 'performance' },
            { nested: { password: 'performance' } },
            { serverUrl: 'http://127.0.0.1:43123' },
            { note: 'leaked benchmark-control-token' },
        ]) {
            assert.throws(
                () =>
                    assertXtreamArtifactRedacted(unsafe, [
                        'benchmark-control-token',
                    ]),
                /credential-safe/
            );
        }
    });
});

type Action = readonly [string, string, number];

function fullActions(): readonly Action[] {
    return [
        ['get_account_info', 'all', 1],
        ['get_live_categories', 'all', 2],
        ['get_vod_categories', 'all', 3],
        ['get_series_categories', 'all', 4],
        ['get_live_streams', 'all', 5],
        ['get_vod_streams', 'all', 6],
        ['get_series', 'all', 7],
    ];
}

function controlState(
    actions: readonly Action[],
    accountCount = 1
): XtreamControlState {
    return {
        epoch: MANIFEST.epoch,
        prepared: MANIFEST,
        rules: [],
        heldIds: [],
        heldCount: 0,
        occurrences: actions.map(([action, categoryId]) => ({
            scenario: 'performance-100k',
            transport: 'direct',
            action,
            categoryId,
            count: action === 'get_account_info' ? accountCount : 1,
        })),
        ledger: actions.flatMap(([action, categoryId, order]) =>
            Array.from(
                {
                    length: action === 'get_account_info' ? accountCount : 1,
                },
                (_, index) => {
                    const shiftedOrder =
                        order +
                        index +
                        (action === 'get_account_info' ? 0 : accountCount - 1);
                    return [
                        {
                            epoch: MANIFEST.epoch,
                            scenario: 'performance-100k',
                            transport: 'direct' as const,
                            action,
                            categoryId,
                            occurrence: index + 1,
                            status: 'arrived' as const,
                            atMs: shiftedOrder * 10,
                        },
                        {
                            epoch: MANIFEST.epoch,
                            scenario: 'performance-100k',
                            transport: 'direct' as const,
                            action,
                            categoryId,
                            occurrence: index + 1,
                            status: 'responded' as const,
                            atMs: shiftedOrder * 10 + 1,
                        },
                    ];
                }
            ).flat()
        ),
    };
}
