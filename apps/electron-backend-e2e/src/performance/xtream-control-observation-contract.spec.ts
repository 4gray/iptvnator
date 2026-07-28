import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_SCENARIO_ID,
    type XtreamControlState,
    type XtreamPerformanceManifest,
} from './xtream-benchmark-contract';
import { assertXtreamControlStateForScenario } from './xtream-control-client';

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

const FULL_ACTIONS = [
    'get_account_info',
    'get_live_categories',
    'get_vod_categories',
    'get_series_categories',
    'get_live_streams',
    'get_vod_streams',
    'get_series',
] as const;

describe('Xtream mock observation contract', () => {
    it('models exact account-info multiplicity for every measured window', () => {
        assert.doesNotThrow(() =>
            validate(
                XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
                controlState(FULL_ACTIONS, 2)
            )
        );
        assert.doesNotThrow(() =>
            validate(
                XTREAM_SCENARIO_ID.CANCEL_IMPORT,
                controlState(FULL_ACTIONS.slice(0, 5), 2)
            )
        );
        for (const scenarioId of [
            XTREAM_SCENARIO_ID.REFRESH_LARGE,
            XTREAM_SCENARIO_ID.BACKGROUND_UI,
        ] as const) {
            assert.doesNotThrow(() =>
                validate(scenarioId, controlState(FULL_ACTIONS, 2, true))
            );
        }
        assert.doesNotThrow(() =>
            validate(XTREAM_SCENARIO_ID.DELETE_LARGE, controlState([], 0))
        );
    });

    it('rejects account-info multiplicity from a different scenario window', () => {
        for (const [scenarioId, state] of [
            [
                XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
                controlState(FULL_ACTIONS, 1),
            ],
            [
                XTREAM_SCENARIO_ID.CANCEL_IMPORT,
                controlState(FULL_ACTIONS.slice(0, 5), 1),
            ],
            [XTREAM_SCENARIO_ID.REFRESH_LARGE, controlState(FULL_ACTIONS, 1)],
            [XTREAM_SCENARIO_ID.BACKGROUND_UI, controlState(FULL_ACTIONS, 1)],
        ] as const) {
            assert.throws(
                () => validate(scenarioId, state),
                /invalid Xtream mock observations/
            );
        }

        for (const scenarioId of [
            XTREAM_SCENARIO_ID.REFRESH_LARGE,
            XTREAM_SCENARIO_ID.BACKGROUND_UI,
        ] as const) {
            assert.throws(
                () => validate(scenarioId, controlState(FULL_ACTIONS, 2)),
                /invalid Xtream mock observations/
            );
        }
    });

    it('allows account overlap but requires complete route-account causality', () => {
        const exact = controlState(FULL_ACTIONS, 2);
        const duplicateArrival = {
            ...exact,
            ledger: exact.ledger.map((entry) =>
                entry.action === 'get_account_info' &&
                entry.occurrence === 2 &&
                entry.status === 'responded'
                    ? { ...entry, status: 'arrived' }
                    : entry
            ),
        };
        const overlappingAccounts = {
            ...exact,
            ledger: exact.ledger.map((entry) =>
                entry.action === 'get_account_info' &&
                entry.occurrence === 1 &&
                entry.status === 'responded'
                    ? { ...entry, atMs: 25 }
                    : entry
            ),
        };
        const routeAccountAfterCategories = {
            ...exact,
            ledger: exact.ledger.map((entry) =>
                entry.action === 'get_account_info' &&
                entry.occurrence === 2 &&
                entry.status === 'responded'
                    ? { ...entry, atMs: 35 }
                    : entry
            ),
        };
        const reversedAccountStarts = {
            ...exact,
            ledger: exact.ledger.map((entry) =>
                entry.action === 'get_account_info' &&
                entry.occurrence === 2 &&
                entry.status === 'arrived'
                    ? { ...entry, atMs: 9 }
                    : entry
            ),
        };

        assert.doesNotThrow(() =>
            validate(
                XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
                overlappingAccounts
            )
        );
        for (const invalid of [
            duplicateArrival,
            reversedAccountStarts,
            routeAccountAfterCategories,
        ]) {
            assert.throws(
                () =>
                    validate(XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE, invalid),
                /invalid Xtream mock observations/
            );
        }
    });
});

function validate(
    scenarioId: Parameters<typeof assertXtreamControlStateForScenario>[0],
    state: XtreamControlState
): void {
    assertXtreamControlStateForScenario(scenarioId, state, MANIFEST);
}

function controlState(
    actions: readonly string[],
    accountCount: number,
    routeAccountAfterContent = false
): XtreamControlState {
    const counts = new Map(
        actions.map((action) => [
            action,
            action === 'get_account_info' ? accountCount : 1,
        ])
    );
    let order = 1;
    return {
        epoch: MANIFEST.epoch,
        prepared: MANIFEST,
        rules: [],
        heldIds: [],
        heldCount: 0,
        occurrences: [...counts].map(([action, count]) => ({
            scenario: 'performance-100k',
            transport: 'direct',
            action,
            categoryId: 'all',
            count,
        })),
        ledger: [...counts].flatMap(([action, count]) =>
            Array.from({ length: count }, (_, index) => {
                const routeAccount =
                    routeAccountAfterContent &&
                    action === 'get_account_info' &&
                    index === 1;
                const arrived = routeAccount ? 1_000 : order++ * 10;
                return [
                    {
                        scenario: 'performance-100k',
                        transport: 'direct',
                        action,
                        categoryId: 'all',
                        epoch: MANIFEST.epoch,
                        occurrence: index + 1,
                        status: 'arrived',
                        atMs: arrived,
                    },
                    {
                        scenario: 'performance-100k',
                        transport: 'direct',
                        action,
                        categoryId: 'all',
                        epoch: MANIFEST.epoch,
                        occurrence: index + 1,
                        status: 'responded',
                        atMs: arrived + 1,
                    },
                ];
            }).flat()
        ),
    };
}
