import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import * as schema from '@iptvnator/shared/database/schema';
import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { createRecordingOperationPhaseCapture } from './performance-phase-capture.test-helpers';
import { deleteXtreamContent } from './xtream.operations';

/** Renders a drizzle filter the way the driver would, for asserting its scope. */
function renderFilter(filter: SQL): { sql: string; params: unknown[] } {
    const query = new SQLiteSyncDialect().sqlToQuery(filter);
    return { sql: query.sql, params: query.params };
}

function createSelectStep(
    rows: readonly unknown[],
    label: string,
    timeline: string[]
) {
    const where = jest.fn(() => {
        timeline.push(label);
        return Promise.resolve(rows);
    });
    const innerJoin = jest.fn(() => ({ where }));
    const from = jest.fn(() => ({ innerJoin, where }));
    return { from };
}

/** The grouped per-category content count query. */
function createCountStep(
    rows: readonly unknown[],
    label: string,
    timeline: string[],
    filters: SQL[]
) {
    const groupBy = jest.fn(() => {
        timeline.push(label);
        return Promise.resolve(rows);
    });
    const where = jest.fn((filter: SQL) => {
        filters.push(filter);
        return { groupBy };
    });
    const innerJoin = jest.fn(() => ({ where }));
    const from = jest.fn(() => ({ innerJoin }));
    return { from };
}

function createDeleteHarness() {
    const timeline: string[] = [];
    const categories = [
        { hidden: true, id: 11, type: 'live', xtreamId: 101 },
        { hidden: false, id: 12, type: 'movies', xtreamId: 102 },
    ];
    const favorites = [
        {
            addedAt: '2026-01-01T00:00:00.000Z',
            contentType: 'live',
            position: 3,
            xtreamId: 201,
        },
    ];
    const recentlyViewed = [
        {
            contentType: 'movie',
            viewedAt: '2026-01-02T00:00:00.000Z',
            xtreamId: 202,
        },
    ];
    // 205 content rows spread over the two categories.
    const contentRowCounts = [
        { categoryId: 11, rowCount: 120 },
        { categoryId: 12, rowCount: 85 },
    ];
    const countFilters: SQL[] = [];
    const deleteFilters: Array<{ table: unknown; filter: SQL }> = [];
    const select = jest
        .fn()
        .mockReturnValueOnce(
            createSelectStep(categories, 'select:categories', timeline)
        )
        .mockReturnValueOnce(
            createSelectStep(favorites, 'select:favorites', timeline)
        )
        .mockReturnValueOnce(
            createSelectStep(recentlyViewed, 'select:recently-viewed', timeline)
        )
        .mockReturnValueOnce(
            createCountStep(
                contentRowCounts,
                'select:content',
                timeline,
                countFilters
            )
        );
    const deleteRows = jest.fn((table: unknown) => ({
        where: jest.fn((filter: SQL) => {
            deleteFilters.push({ table, filter });
            return {
                run: jest.fn(() => ({
                    changes: table === schema.content ? 205 : 2,
                })),
            };
        }),
    }));
    const transaction = jest.fn((execute: (tx: unknown) => unknown) => {
        timeline.push('transaction');
        return execute({ delete: deleteRows });
    });

    return {
        countFilters,
        db: { select, transaction } as unknown as AppDatabase,
        deleteFilters,
        timeline,
        transaction,
    };
}

describe('Xtream delete performance phases', () => {
    it('times all user-data collection but counts only content/category deletion candidates', async () => {
        const harness = createDeleteHarness();
        const recording = createRecordingOperationPhaseCapture((event) => {
            harness.timeline.push(`${event.phase}:${event.boundary}`);
        });
        const checkpoint = jest.fn(() => {
            harness.timeline.push('checkpoint');
        });
        const onProgress = jest.fn(
            (progress: {
                phase: string;
                current?: number;
                total?: number;
                increment?: number;
            }) => {
                harness.timeline.push(`progress:${progress.current}`);
            }
        );

        await expect(
            deleteXtreamContent(
                harness.db,
                'playlist-1',
                { checkpoint, onProgress },
                recording.capture
            )
        ).resolves.toEqual({
            favorites: [
                {
                    addedAt: '2026-01-01T00:00:00.000Z',
                    contentType: 'live',
                    position: 3,
                    xtreamId: 201,
                },
            ],
            hiddenCategories: [{ categoryType: 'live', xtreamId: 101 }],
            recentlyViewed: [
                {
                    contentType: 'movie',
                    viewedAt: '2026-01-02T00:00:00.000Z',
                    xtreamId: 202,
                },
            ],
            success: true,
        });

        // 205 rows fit one row-budgeted category group, then the categories
        // go in a single statement.
        expect(harness.transaction).toHaveBeenCalledTimes(2);
        // Progress reporting performs a second cooperative checkpoint after
        // each committed batch.
        expect(checkpoint).toHaveBeenCalledTimes(4);
        expect(onProgress.mock.calls.map(([value]) => value)).toEqual([
            {
                phase: 'deleting-content',
                current: 205,
                total: 205,
                increment: 205,
            },
            {
                phase: 'deleting-categories',
                current: 2,
                total: 2,
                increment: 2,
            },
        ]);
        expect(harness.timeline.slice(1, 5)).toEqual([
            'select:categories',
            'select:favorites',
            'select:recently-viewed',
            'select:content',
        ]);
        // The count and both deletes stay scoped to the category ids the
        // collection read, never to the playlist: a newer import of the same
        // playlist may create categories between the read and the delete.
        expect(harness.countFilters.map(renderFilter)).toEqual([
            { sql: '"categories"."id" in (?, ?)', params: [11, 12] },
        ]);
        expect(
            harness.deleteFilters.map(({ table, filter }) => ({
                table: table === schema.content ? 'content' : 'categories',
                ...renderFilter(filter),
            }))
        ).toEqual([
            {
                table: 'content',
                sql: '"content"."category_id" in (?, ?)',
                params: [11, 12],
            },
            {
                table: 'categories',
                sql: '"categories"."id" in (?, ?)',
                params: [11, 12],
            },
        ]);
        const writeStart = harness.timeline.indexOf(
            'sqlite.xtream-delete.write-transactions:start'
        );
        const writeEnd = harness.timeline.indexOf(
            'sqlite.xtream-delete.write-transactions:end'
        );
        expect(writeEnd).toBeGreaterThan(
            harness.timeline.lastIndexOf('progress:2')
        );
        expect(
            harness.timeline
                .map((entry, index) => ({ entry, index }))
                .filter(({ entry }) => entry === 'transaction')
                .every(({ index }) => index > writeStart && index < writeEnd)
        ).toBe(true);
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 207 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
            },
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 207 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
            },
        ]);
    });

    it('closes the write phase on cancellation and preserves error identity', async () => {
        const harness = createDeleteHarness();
        const recording = createRecordingOperationPhaseCapture();
        const cancellation = new Error('synthetic cancellation');
        cancellation.name = 'AbortError';
        let checkpointCount = 0;

        await expect(
            deleteXtreamContent(
                harness.db,
                'playlist-1',
                {
                    checkpoint: () => {
                        checkpointCount += 1;
                        if (checkpointCount === 2) {
                            throw cancellation;
                        }
                    },
                },
                recording.capture
            )
        ).rejects.toBe(cancellation);

        expect(harness.transaction).toHaveBeenCalledTimes(1);
        expect(recording.events.at(-1)).toEqual({
            boundary: 'end',
            phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
        });
    });

    it('closes collection on query failure and preserves error identity', async () => {
        const failure = new Error('synthetic select failure');
        const where = jest.fn().mockRejectedValue(failure);
        const from = jest.fn(() => ({ where }));
        const db = {
            select: jest.fn(() => ({ from })),
        } as unknown as AppDatabase;
        const recording = createRecordingOperationPhaseCapture();

        await expect(
            deleteXtreamContent(db, 'playlist-1', undefined, recording.capture)
        ).rejects.toBe(failure);

        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
            },
            {
                boundary: 'end',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
            },
        ]);
    });
});
