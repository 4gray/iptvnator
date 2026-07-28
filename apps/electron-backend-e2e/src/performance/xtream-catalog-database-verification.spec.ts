import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_SCENARIO_ID,
    type XtreamPerformanceManifest,
} from './xtream-benchmark-contract';
import {
    assertXtreamCatalogDatabaseSnapshot,
    createXtreamCatalogVerification,
    type XtreamCatalogDatabaseSnapshot,
} from './xtream-catalog-database-verification';

describe('Xtream catalog database verification', () => {
    it('accepts the exact synthetic catalog after import and refresh scenarios', () => {
        for (const scenarioId of [
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            XTREAM_SCENARIO_ID.REFRESH_LARGE,
            XTREAM_SCENARIO_ID.BACKGROUND_UI,
        ] as const) {
            const snapshot = importedSnapshot();

            assert.doesNotThrow(() =>
                assertXtreamCatalogDatabaseSnapshot(
                    snapshot,
                    manifest(),
                    scenarioId
                )
            );
            assert.deepEqual(
                createXtreamCatalogVerification(
                    snapshot,
                    manifest(),
                    scenarioId
                ),
                {
                    databaseStateValid: true,
                    fixtureIdentityValid: true,
                    providerCategoryCount: 100,
                    providerItemCount: 100_000,
                    verifiedAfterCapture: true,
                }
            );
        }
    });

    it('pins the current cancellation cleanup state and complete source deletion', () => {
        assert.doesNotThrow(() =>
            assertXtreamCatalogDatabaseSnapshot(
                emptySnapshot({
                    matchingPlaylistCount: 1,
                    matchingPlaylistType: 'xtream',
                    playlistCount: 1,
                    statuses: {
                        live: 'failed',
                        movie: 'failed',
                        series: 'failed',
                    },
                }),
                manifest(),
                XTREAM_SCENARIO_ID.CANCEL_IMPORT
            )
        );
        assert.throws(
            () =>
                assertXtreamCatalogDatabaseSnapshot(
                    emptySnapshot({
                        matchingPlaylistCount: 1,
                        matchingPlaylistType: 'xtream',
                        playlistCount: 1,
                        statuses: {
                            live: 'cancelled',
                            movie: 'cancelled',
                            series: 'cancelled',
                        },
                    }),
                    manifest(),
                    XTREAM_SCENARIO_ID.CANCEL_IMPORT
                ),
            /invalid Xtream database catalog state/
        );
        assert.doesNotThrow(() =>
            assertXtreamCatalogDatabaseSnapshot(
                emptySnapshot(),
                manifest(),
                XTREAM_SCENARIO_ID.DELETE_LARGE
            )
        );
    });

    it('rejects partial, foreign, mis-associated, and non-terminal database state', () => {
        const baseline = importedSnapshot();
        const invalid: XtreamCatalogDatabaseSnapshot[] = [
            { ...baseline, playlistCount: 2 },
            {
                ...baseline,
                categories: {
                    ...baseline.categories,
                    live: {
                        ...baseline.categories.live,
                        distinctXtreamIdCount: 59,
                    },
                },
            },
            {
                ...baseline,
                content: {
                    ...baseline.content,
                    movie: {
                        ...baseline.content.movie,
                        maxXtreamId: 2_019_998,
                    },
                },
            },
            {
                ...baseline,
                content: {
                    ...baseline.content,
                    series: {
                        ...baseline.content.series,
                        invalidCategoryCardinalityCount: 1,
                    },
                },
            },
            {
                ...baseline,
                content: {
                    ...baseline.content,
                    live: {
                        ...baseline.content.live,
                        invalidTitleCount: 1,
                    },
                },
            },
            {
                ...baseline,
                importStatuses: {
                    ...baseline.importStatuses,
                    movie: 'importing',
                },
            },
            {
                ...baseline,
                databaseReadStartedEpochMs: baseline.captureStoppedEpochMs - 1,
            },
        ];

        for (const snapshot of invalid) {
            assert.throws(
                () =>
                    assertXtreamCatalogDatabaseSnapshot(
                        snapshot,
                        manifest(),
                        XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
                    ),
                /^Error: invalid Xtream database catalog state$/u
            );
        }
    });

    it('rejects cancellation residue and a delete that left the source row behind', () => {
        const cancelled = emptySnapshot({
            matchingPlaylistCount: 1,
            matchingPlaylistType: 'xtream',
            playlistCount: 1,
            statuses: {
                live: 'failed',
                movie: 'failed',
                series: 'failed',
            },
        });
        const cancelWithResidue: XtreamCatalogDatabaseSnapshot = {
            ...cancelled,
            content: {
                ...cancelled.content,
                live: {
                    ...cancelled.content.live,
                    count: 1,
                    distinctXtreamIdCount: 1,
                    maxXtreamId: 1_000_000,
                    minXtreamId: 1_000_000,
                },
            },
            contentCount: 1,
        };

        assert.throws(
            () =>
                assertXtreamCatalogDatabaseSnapshot(
                    cancelWithResidue,
                    manifest(),
                    XTREAM_SCENARIO_ID.CANCEL_IMPORT
                ),
            /invalid Xtream database catalog state/
        );
        assert.throws(
            () =>
                assertXtreamCatalogDatabaseSnapshot(
                    emptySnapshot({
                        matchingPlaylistCount: 1,
                        matchingPlaylistType: 'xtream',
                        playlistCount: 1,
                    }),
                    manifest(),
                    XTREAM_SCENARIO_ID.DELETE_LARGE
                ),
            /invalid Xtream database catalog state/
        );
    });

    it('uses one canonical fixture manifest snapshot', () => {
        const expectedManifest = manifest();
        const reducedCounts = {
            categories: { live: 1, series: 1, total: 3, vod: 1 },
            items: { live: 1, series: 1, total: 3, vod: 1 },
        };
        let countReads = 0;
        const changingManifest = {
            ...expectedManifest,
            get counts() {
                countReads += 1;
                return countReads === 1
                    ? expectedManifest.counts
                    : reducedCounts;
            },
        };
        const reducedSnapshot: XtreamCatalogDatabaseSnapshot = {
            ...importedSnapshot(),
            categories: {
                live: partition(1, 91_101),
                movies: partition(1, 92_101),
                series: partition(1, 93_101),
            },
            categoryCount: 3,
            content: {
                live: contentPartition(1, 1_000_000),
                movie: contentPartition(1, 2_000_000),
                series: contentPartition(1, 3_000_000),
            },
            contentCount: 3,
        };

        assert.throws(
            () =>
                createXtreamCatalogVerification(
                    reducedSnapshot,
                    changingManifest,
                    XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
                ),
            /invalid Xtream database catalog state/
        );
        assert.equal(countReads, 1);
    });
});

function manifest(): XtreamPerformanceManifest {
    return {
        bytes: 12_345_678,
        catalogSha256: 'a'.repeat(64),
        counts: {
            categories: { live: 60, series: 20, total: 100, vod: 20 },
            items: {
                live: 60_000,
                series: 20_000,
                total: 100_000,
                vod: 20_000,
            },
        },
        epoch: 1,
        scenario: 'performance-100k',
        seed: 91_001,
    };
}

function importedSnapshot(): XtreamCatalogDatabaseSnapshot {
    return {
        captureStoppedEpochMs: 1_000,
        categories: {
            live: partition(60, 91_101),
            movies: partition(20, 92_101),
            series: partition(20, 93_101),
        },
        categoryCount: 100,
        content: {
            live: contentPartition(60_000, 1_000_000),
            movie: contentPartition(20_000, 2_000_000),
            series: contentPartition(20_000, 3_000_000),
        },
        contentCount: 100_000,
        databaseReadStartedEpochMs: 1_001,
        importStatuses: {
            live: 'completed',
            movie: 'completed',
            series: 'completed',
        },
        matchingPlaylistCount: 1,
        matchingPlaylistType: 'xtream',
        playlistCount: 1,
    };
}

function emptySnapshot(
    options: {
        matchingPlaylistCount?: number;
        matchingPlaylistType?: string | null;
        playlistCount?: number;
        statuses?: XtreamCatalogDatabaseSnapshot['importStatuses'];
    } = {}
): XtreamCatalogDatabaseSnapshot {
    return {
        captureStoppedEpochMs: 1_000,
        categories: {
            live: partition(0, null),
            movies: partition(0, null),
            series: partition(0, null),
        },
        categoryCount: 0,
        content: {
            live: contentPartition(0, null),
            movie: contentPartition(0, null),
            series: contentPartition(0, null),
        },
        contentCount: 0,
        databaseReadStartedEpochMs: 1_001,
        importStatuses: options.statuses ?? {
            live: 'completed',
            movie: 'completed',
            series: 'completed',
        },
        matchingPlaylistCount: options.matchingPlaylistCount ?? 0,
        matchingPlaylistType: options.matchingPlaylistType ?? null,
        playlistCount: options.playlistCount ?? 0,
    };
}

function partition(
    count: number,
    minXtreamId: number | null
): XtreamCatalogDatabaseSnapshot['categories']['live'] {
    return {
        count,
        distinctXtreamIdCount: count,
        invalidNameCount: 0,
        maxXtreamId: minXtreamId === null ? null : minXtreamId + count - 1,
        minXtreamId,
    };
}

function contentPartition(
    count: number,
    minXtreamId: number | null
): XtreamCatalogDatabaseSnapshot['content']['live'] {
    return {
        count,
        distinctXtreamIdCount: count,
        invalidCategoryCardinalityCount: 0,
        invalidTitleCount: 0,
        maxXtreamId: minXtreamId === null ? null : minXtreamId + count - 1,
        minXtreamId,
    };
}
