import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    expectedXtreamWorkerRequestInventory,
    XTREAM_SCENARIO_ID,
} from './xtream-benchmark-contract';

describe('Xtream database-worker request inventory', () => {
    it('defines the exact operation, outcome, and phase multiset for every scenario', () => {
        const expectedTotals = new Map([
            [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE, 29],
            [XTREAM_SCENARIO_ID.REFRESH_LARGE, 35],
            [XTREAM_SCENARIO_ID.DELETE_LARGE, 2],
            [XTREAM_SCENARIO_ID.CANCEL_IMPORT, 23],
            [XTREAM_SCENARIO_ID.BACKGROUND_UI, 38],
        ]);

        for (const scenarioId of Object.values(XTREAM_SCENARIO_ID)) {
            const inventory = expectedXtreamWorkerRequestInventory(scenarioId);
            assert.equal(
                inventory.reduce((total, entry) => total + entry.count, 0),
                expectedTotals.get(scenarioId)
            );
            assert.ok(
                inventory.every(
                    ({ count, operation, success, phases }) =>
                        Number.isSafeInteger(count) &&
                        count > 0 &&
                        operation.startsWith('DB_') &&
                        typeof success === 'boolean' &&
                        phases.every((phase) => phase.length > 0)
                )
            );
        }
    });
});
