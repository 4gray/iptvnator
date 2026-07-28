import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    expectedXtreamWorkerRequestInventory,
    XTREAM_SCENARIO_ID,
} from './xtream-benchmark-contract';

describe('Xtream database-worker request inventory', () => {
    it('defines the exact operation, outcome, and phase multiset for every scenario', () => {
        const expectedTotals = new Map([
            [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE, 30],
            [XTREAM_SCENARIO_ID.REFRESH_LARGE, 51],
            [XTREAM_SCENARIO_ID.DELETE_LARGE, 2],
            [XTREAM_SCENARIO_ID.CANCEL_IMPORT, 24],
            [XTREAM_SCENARIO_ID.BACKGROUND_UI, 54],
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

    it('includes the route hydration requests observed after refresh commit', () => {
        for (const scenarioId of [
            XTREAM_SCENARIO_ID.REFRESH_LARGE,
            XTREAM_SCENARIO_ID.BACKGROUND_UI,
        ]) {
            const counts = new Map(
                expectedXtreamWorkerRequestInventory(scenarioId).map(
                    ({ count, operation }) => [operation, count]
                )
            );

            assert.equal(counts.get('DB_GET_PLAYLIST'), 2);
            assert.equal(counts.get('DB_GET_APP_STATE'), 12);
            assert.equal(counts.get('DB_GET_CATEGORIES'), 9);
            assert.equal(counts.get('DB_GET_CONTENT'), 9);
            assert.equal(counts.get('DB_SET_APP_STATE'), 6);
        }
    });

    it('attributes portal-route hydration without accepting dashboard work', () => {
        for (const scenarioId of [
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            XTREAM_SCENARIO_ID.REFRESH_LARGE,
            XTREAM_SCENARIO_ID.CANCEL_IMPORT,
            XTREAM_SCENARIO_ID.BACKGROUND_UI,
        ]) {
            const operations = expectedXtreamWorkerRequestInventory(
                scenarioId
            ).map(({ operation }) => operation);
            assert.ok(operations.includes('DB_GET_PLAYLIST'));
        }

        for (const scenarioId of [
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            XTREAM_SCENARIO_ID.CANCEL_IMPORT,
        ]) {
            const operations = expectedXtreamWorkerRequestInventory(
                scenarioId
            ).map(({ operation }) => operation);
            assert.ok(operations.includes('DB_GET_ALL_PLAYBACK_POSITIONS'));
            assert.equal(
                operations.includes('DB_GET_GLOBAL_RECENTLY_ADDED'),
                false
            );
        }
    });
});
