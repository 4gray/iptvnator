import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import type { XtreamMainCaptureStatus } from './m3u-refresh-main-capture';
import { isXtreamMainCaptureSettled } from './xtream-main-settlement';

describe('Xtream main capture settlement', () => {
    for (const [scenarioId, expectedCount] of [
        [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE, 30],
        [XTREAM_SCENARIO_ID.REFRESH_LARGE, 51],
        [XTREAM_SCENARIO_ID.DELETE_LARGE, 2],
        [XTREAM_SCENARIO_ID.CANCEL_IMPORT, 24],
        [XTREAM_SCENARIO_ID.BACKGROUND_UI, 54],
    ] as const) {
        it(`accepts the exact terminal inventory for ${scenarioId}`, () => {
            const status = settledStatus(scenarioId);

            assert.equal(
                status.operationOutcomes.reduce(
                    (total, entry) => total + entry.count,
                    0
                ),
                expectedCount
            );
            assert.equal(isXtreamMainCaptureSettled(status, scenarioId), true);
        });
    }

    it('reports unsettled while a known request remains pending', () => {
        const status = settledStatus(XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE);
        const first = status.operationOutcomes[0];
        assert.ok(first);

        assert.equal(
            isXtreamMainCaptureSettled(
                {
                    ...status,
                    activeOperations: [
                        {
                            operation: first.operation,
                            operationId: 'operation-1',
                            playlistId: 'playlist-1',
                            progress: null,
                            requestId: 'request-1',
                        },
                    ],
                    operationOutcomes: [
                        ...status.operationOutcomes.slice(1),
                        {
                            count: 1,
                            operation: first.operation,
                            outcome: 'pending',
                        },
                        ...(first.count > 1
                            ? [{ ...first, count: first.count - 1 }]
                            : []),
                    ],
                },
                XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
            ),
            false
        );
    });

    it('reports unsettled through the measured refresh route-content tail', () => {
        const status = settledStatus(XTREAM_SCENARIO_ID.REFRESH_LARGE);
        const content = status.operationOutcomes.find(
            ({ operation }) => operation === 'DB_GET_CONTENT'
        );
        assert.deepEqual(content, {
            count: 9,
            operation: 'DB_GET_CONTENT',
            outcome: 'success',
        });

        assert.equal(
            isXtreamMainCaptureSettled(
                {
                    ...status,
                    activeOperations: [
                        {
                            operation: 'DB_GET_CONTENT',
                            operationId: null,
                            playlistId: 'playlist-1',
                            progress: null,
                            requestId: 'route-live-read',
                        },
                    ],
                    operationOutcomes: [
                        ...status.operationOutcomes.filter(
                            (entry) => entry !== content
                        ),
                        {
                            count: 6,
                            operation: 'DB_GET_CONTENT',
                            outcome: 'success',
                        },
                        {
                            count: 1,
                            operation: 'DB_GET_CONTENT',
                            outcome: 'pending',
                        },
                    ],
                },
                XTREAM_SCENARIO_ID.REFRESH_LARGE
            ),
            false
        );
    });

    it('fails closed on unexpected operations, excess counts, workers, and invalid capture evidence', () => {
        const status = settledStatus(XTREAM_SCENARIO_ID.REFRESH_LARGE);
        const invalid: XtreamMainCaptureStatus[] = [
            {
                ...status,
                operationOutcomes: [
                    ...status.operationOutcomes,
                    {
                        count: 1,
                        operation: 'DB_FOREIGN_OPERATION',
                        outcome: 'success',
                    },
                ],
            },
            {
                ...status,
                databaseWorkerCount: 2,
            },
            {
                ...status,
                playlistRefreshWorkerCount: 1,
            },
            {
                ...status,
                invalidReasons: ['database-capture-invalid'],
            },
            {
                ...status,
                lateDatabaseRequestCount: 1,
                lateEventCount: 1,
            },
        ];

        for (const candidate of invalid) {
            assert.throws(
                () =>
                    isXtreamMainCaptureSettled(
                        candidate,
                        XTREAM_SCENARIO_ID.REFRESH_LARGE
                    ),
                /xtream-main-settlement-invalid/
            );
        }
    });

    it('requires the cancellation save-content request to fail and every other request to succeed', () => {
        const status = settledStatus(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const failed = status.operationOutcomes.find(
            ({ operation, outcome }) =>
                operation === 'DB_SAVE_CONTENT' && outcome === 'error'
        );
        assert.deepEqual(failed, {
            count: 1,
            operation: 'DB_SAVE_CONTENT',
            outcome: 'error',
        });

        assert.throws(
            () =>
                isXtreamMainCaptureSettled(
                    {
                        ...status,
                        operationOutcomes: status.operationOutcomes.map(
                            (entry) =>
                                entry === failed
                                    ? { ...entry, outcome: 'success' }
                                    : entry
                        ),
                    },
                    XTREAM_SCENARIO_ID.CANCEL_IMPORT
                ),
            /xtream-main-settlement-invalid/
        );
    });
});

function settledStatus(scenarioId: XtreamScenarioId): XtreamMainCaptureStatus {
    const expected = expectedOutcomes(scenarioId);
    return {
        active: true,
        activeOperations: [],
        captureGeneration: 2,
        captureStartedEpochMs: 1_000,
        cutoffPhase: 'active',
        databaseWorkerCount: 1,
        invalidReasons: [],
        lateDatabaseRequestCount: 0,
        lateEventCount: 0,
        measurementPhase: 'measuring',
        measurementStartedEpochMs: 1_001,
        operationOutcomes: expected,
        playlistRefreshWorkerCount: 0,
    };
}

function expectedOutcomes(
    scenarioId: XtreamScenarioId
): XtreamMainCaptureStatus['operationOutcomes'] {
    const inventory = {
        [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE]: [
            ['DB_UPSERT_APP_PLAYLIST', 1],
            ['DB_GET_PLAYLIST', 1],
            ['DB_GET_ALL_PLAYBACK_POSITIONS', 1],
            ['DB_GET_APP_STATE', 6],
            ['DB_GET_CATEGORIES', 6],
            ['DB_SAVE_CATEGORIES', 3],
            ['DB_GET_CONTENT', 6],
            ['DB_SAVE_CONTENT', 3],
            ['DB_SET_APP_STATE', 3],
        ],
        [XTREAM_SCENARIO_ID.REFRESH_LARGE]: [
            ['DB_DELETE_XTREAM_CONTENT', 1],
            ['DB_GET_ALL_PLAYBACK_POSITIONS', 1],
            ['DB_UPDATE_PLAYLIST', 1],
            ['DB_GET_APP_PLAYLIST', 1],
            ['DB_GET_PLAYLIST', 2],
            ['DB_UPSERT_APP_PLAYLIST', 1],
            ['DB_GET_APP_STATE', 12],
            ['DB_GET_CATEGORIES', 9],
            ['DB_SAVE_CATEGORIES', 3],
            ['DB_GET_CONTENT', 9],
            ['DB_SAVE_CONTENT', 3],
            ['DB_SET_APP_STATE', 6],
            ['DB_RESTORE_XTREAM_USER_DATA', 1],
            ['DB_CLEAR_ALL_PLAYBACK_POSITIONS', 1],
        ],
        [XTREAM_SCENARIO_ID.DELETE_LARGE]: [['DB_DELETE_PLAYLIST', 2]],
        [XTREAM_SCENARIO_ID.CANCEL_IMPORT]: [
            ['DB_UPSERT_APP_PLAYLIST', 1],
            ['DB_GET_PLAYLIST', 1],
            ['DB_GET_ALL_PLAYBACK_POSITIONS', 1],
            ['DB_GET_APP_STATE', 4],
            ['DB_GET_CATEGORIES', 6],
            ['DB_SAVE_CATEGORIES', 3],
            ['DB_GET_CONTENT', 1],
            ['DB_SAVE_CONTENT', 1],
            ['DB_SET_APP_STATE', 3],
            ['DB_CLEAR_XTREAM_IMPORT_CACHE', 3],
        ],
        [XTREAM_SCENARIO_ID.BACKGROUND_UI]: [
            ['DB_DELETE_XTREAM_CONTENT', 1],
            ['DB_GET_ALL_PLAYBACK_POSITIONS', 1],
            ['DB_UPDATE_PLAYLIST', 1],
            ['DB_GET_APP_PLAYLIST', 1],
            ['DB_GET_PLAYLIST', 2],
            ['DB_UPSERT_APP_PLAYLIST', 1],
            ['DB_GET_APP_STATE', 12],
            ['DB_GET_CATEGORIES', 9],
            ['DB_SAVE_CATEGORIES', 3],
            ['DB_GET_CONTENT', 9],
            ['DB_SAVE_CONTENT', 3],
            ['DB_SET_APP_STATE', 6],
            ['DB_RESTORE_XTREAM_USER_DATA', 1],
            ['DB_CLEAR_ALL_PLAYBACK_POSITIONS', 1],
            ['DB_GET_RECENTLY_VIEWED', 1],
            ['DB_GET_ALL_GLOBAL_FAVORITES', 1],
            ['DB_GET_GLOBAL_RECENTLY_ADDED', 1],
        ],
    } as const;
    return inventory[scenarioId]
        .map(([operation, count]) => ({
            count,
            operation,
            outcome:
                scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT &&
                operation === 'DB_SAVE_CONTENT'
                    ? ('error' as const)
                    : ('success' as const),
        }))
        .sort((left, right) => left.operation.localeCompare(right.operation));
}
