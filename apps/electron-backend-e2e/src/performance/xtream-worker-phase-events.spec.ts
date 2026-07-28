import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseXtreamWorkerPerformancePhaseEvents } from './xtream-worker-phase-events';

function phasePair(
    phase: string,
    startEpochMs: number,
    itemCount: number,
    requestId = 'request-1'
) {
    return [
        {
            boundary: 'start',
            durationMs: null,
            epochMs: startEpochMs,
            phase,
            requestId,
        },
        {
            boundary: 'end',
            durationMs: 2,
            epochMs: startEpochMs + 2,
            metadata: { itemCount },
            phase,
            requestId,
        },
    ];
}

describe('Xtream worker performance phase parser', () => {
    it('accepts each exact finalized operation sequence', () => {
        const fixtures = [
            ['DB_GET_CATEGORIES', phasePair('sqlite.categories.read', 11, 100)],
            [
                'DB_SAVE_CATEGORIES',
                [
                    ...phasePair('normalize.categories', 11, 100),
                    ...phasePair(
                        'sqlite.categories.write-transactions',
                        14,
                        100
                    ),
                ],
            ],
            ['DB_GET_CONTENT', phasePair('sqlite.content.read', 11, 60_000)],
            [
                'DB_SAVE_CONTENT',
                [
                    ...phasePair('sqlite.content.category-map-read', 11, 60),
                    ...phasePair('normalize.content', 14, 60_000),
                    ...phasePair(
                        'sqlite.content.write-transactions',
                        17,
                        60_000
                    ),
                ],
            ],
            [
                'DB_CLEAR_XTREAM_IMPORT_CACHE',
                phasePair(
                    'sqlite.xtream-cache-clear.write-transactions',
                    11,
                    60_060
                ),
            ],
            [
                'DB_DELETE_XTREAM_CONTENT',
                [
                    ...phasePair(
                        'sqlite.xtream-delete.collect-user-data',
                        11,
                        60_060
                    ),
                    ...phasePair(
                        'sqlite.xtream-delete.write-transactions',
                        14,
                        60_060
                    ),
                ],
            ],
            [
                'DB_DELETE_PLAYLIST',
                [
                    ...phasePair(
                        'sqlite.playlist-delete.collect-ids',
                        11,
                        60_060
                    ),
                    ...phasePair(
                        'sqlite.playlist-delete.write-transactions',
                        14,
                        60_061
                    ),
                ],
            ],
            [
                'DB_SEARCH_CONTENT',
                [
                    ...phasePair('sqlite.search.query', 11, 200),
                    ...phasePair('normalize.search-rank', 14, 50),
                ],
            ],
        ] as const;

        for (const [operation, events] of fixtures) {
            assert.deepEqual(
                parseXtreamWorkerPerformancePhaseEvents(
                    operation,
                    events,
                    10,
                    30,
                    true
                ),
                events
            );
        }
    });

    it('returns undefined for non-Xtream operations and null for invalid Xtream events', () => {
        assert.equal(
            parseXtreamWorkerPerformancePhaseEvents(
                'DB_GET_APP_PLAYLIST',
                [],
                10,
                30,
                true
            ),
            undefined
        );

        const valid = phasePair('sqlite.categories.read', 11, 100);
        for (const invalid of [
            [],
            valid.slice(0, 1),
            [...valid].reverse(),
            [
                valid[0],
                { ...valid[1], metadata: { itemCount: 100, secret: 'no' } },
            ],
            [valid[0], { ...valid[1], epochMs: 9 }],
            [valid[0], { ...valid[1], requestId: 'request-2' }],
            [valid[0], { ...valid[1], phase: 'sqlite.write' }],
            [valid[0], { ...valid[1], durationMs: -1 }],
        ]) {
            assert.equal(
                parseXtreamWorkerPerformancePhaseEvents(
                    'DB_GET_CATEGORIES',
                    invalid,
                    10,
                    30,
                    true
                ),
                null
            );
        }
    });

    it('allows missing end count metadata only for unsuccessful partial captures', () => {
        const partial = [
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 11,
                phase: 'sqlite.categories.read',
                requestId: 'request-1',
            },
            {
                boundary: 'end',
                durationMs: 2,
                epochMs: 13,
                phase: 'sqlite.categories.read',
                requestId: 'request-1',
            },
        ];

        assert.equal(
            parseXtreamWorkerPerformancePhaseEvents(
                'DB_GET_CATEGORIES',
                partial,
                10,
                30,
                true
            ),
            null
        );
        assert.deepEqual(
            parseXtreamWorkerPerformancePhaseEvents(
                'DB_GET_CATEGORIES',
                partial,
                10,
                30,
                false
            ),
            partial
        );

        assert.deepEqual(
            parseXtreamWorkerPerformancePhaseEvents(
                'DB_SAVE_CONTENT',
                phasePair('sqlite.content.category-map-read', 11, 60),
                10,
                30,
                false
            ),
            phasePair('sqlite.content.category-map-read', 11, 60)
        );
    });
});
