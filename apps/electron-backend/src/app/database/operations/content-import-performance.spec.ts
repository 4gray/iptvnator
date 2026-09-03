import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import {
    clearXtreamImportCache,
    getContent,
    saveContent,
} from './content.operations';
import { createRecordingOperationPhaseCapture } from './performance-phase-capture.test-helpers';

function createContentDb(streamCount: number, timeline: string[]) {
    const existingWhere = jest.fn().mockResolvedValue([{ count: 0 }]);
    const categoriesWhere = jest
        .fn()
        .mockResolvedValue([{ id: 42, xtreamId: 201 }]);
    const select = jest
        .fn()
        .mockReturnValueOnce({
            from: jest.fn(() => ({
                innerJoin: jest.fn(() => ({ where: existingWhere })),
            })),
        })
        .mockReturnValueOnce({
            from: jest.fn(() => ({ where: categoriesWhere })),
        });
    const run = jest.fn();
    const values = jest.fn((_chunk: unknown[]) => ({
        onConflictDoNothing: jest.fn(() => ({ run })),
    }));
    const insert = jest.fn(() => ({ values }));
    const transactionResults: unknown[] = [];
    const transaction = jest.fn((callback: (tx: unknown) => unknown) => {
        timeline.push('transaction');
        const result = callback({ insert });
        transactionResults.push(result);
        return result;
    });
    const streams = Array.from({ length: streamCount }, (_, index) => ({
        category_id: '201',
        name: `Channel ${index}`,
        stream_id: String(index + 1),
    }));

    return {
        db: { select, transaction } as unknown as AppDatabase,
        streams,
        transaction,
        transactionResults,
        values,
    };
}

describe('content import performance phases', () => {
    it('keeps the content read phase open until the ordered query resolves', async () => {
        const rows = [{ id: 1, title: 'One' }];
        let resolveRows!: (value: typeof rows) => void;
        const pending = new Promise<typeof rows>((resolve) => {
            resolveRows = resolve;
        });
        const orderBy = jest.fn(() => pending);
        const where = jest.fn(() => ({ orderBy }));
        const innerJoin = jest.fn(() => ({ where }));
        const from = jest.fn(() => ({ innerJoin }));
        const db = {
            select: jest.fn(() => ({ from })),
        } as unknown as AppDatabase;
        const recording = createRecordingOperationPhaseCapture();

        const result = getContent(db, 'playlist-1', 'live', recording.capture);
        expect(recording.events).toHaveLength(1);

        resolveRows(rows);
        await expect(result).resolves.toBe(rows);
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_READ,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 1 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_READ,
            },
        ]);
    });

    it('uses one aggregate write pair around every existing batch commit and progress callback', async () => {
        const timeline: string[] = [];
        const recording = createRecordingOperationPhaseCapture((event) =>
            timeline.push(`${event.phase}:${event.boundary}`)
        );
        const harness = createContentDb(205, timeline);
        const checkpoint = jest.fn(() => {
            timeline.push('checkpoint');
        });
        const onProgress = jest.fn((progress: { current?: number }) => {
            timeline.push(`progress:${progress.current}`);
        });

        await expect(
            saveContent(
                harness.db,
                'playlist-1',
                harness.streams,
                'live',
                { checkpoint, onProgress },
                recording.capture
            )
        ).resolves.toEqual({ success: true, count: 205 });

        // 205 rows fit one row-budgeted commit made of three 100-row
        // statements.
        expect(harness.transaction).toHaveBeenCalledTimes(1);
        expect(harness.transactionResults).toEqual([undefined]);
        expect(
            harness.values.mock.calls.map(([chunk]) => chunk.length)
        ).toEqual([100, 100, 5]);
        expect(onProgress.mock.calls.map(([value]) => value.current)).toEqual([
            205,
        ]);
        const writeStart = timeline.indexOf(
            'sqlite.content.write-transactions:start'
        );
        const writeEnd = timeline.indexOf(
            'sqlite.content.write-transactions:end'
        );
        expect(writeStart).toBeGreaterThanOrEqual(0);
        expect(writeEnd).toBeGreaterThan(timeline.lastIndexOf('progress:205'));
        expect(
            timeline
                .map((entry, index) => ({ entry, index }))
                .filter(({ entry }) => entry === 'transaction')
                .every(({ index }) => index > writeStart && index < writeEnd)
        ).toBe(true);
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 1 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
            },
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_CONTENT,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 205 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_CONTENT,
            },
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 205 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
            },
        ]);
    });

    it('closes the aggregate write phase on cancellation without changing the error', async () => {
        const timeline: string[] = [];
        const recording = createRecordingOperationPhaseCapture();
        const harness = createContentDb(101, timeline);
        const cancellation = new Error('cancelled');
        cancellation.name = 'AbortError';
        let checkpointCount = 0;

        await expect(
            saveContent(
                harness.db,
                'playlist-1',
                harness.streams,
                'live',
                {
                    checkpoint: () => {
                        checkpointCount += 1;
                        if (checkpointCount === 2) throw cancellation;
                    },
                },
                recording.capture
            )
        ).rejects.toBe(cancellation);

        expect(harness.transaction).toHaveBeenCalledTimes(1);
        expect(recording.events.at(-1)).toEqual({
            boundary: 'end',
            phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
        });
    });

    it('captures cache deletion as one pair across content groups and categories', async () => {
        const categoryRows = Array.from({ length: 150 }, (_, id) => ({ id }));
        // 205 content rows counted over three of the categories.
        const contentRowCounts = [
            { categoryId: 0, rowCount: 100 },
            { categoryId: 1, rowCount: 100 },
            { categoryId: 2, rowCount: 5 },
        ];
        const select = jest
            .fn()
            .mockReturnValueOnce({
                from: jest.fn(() => ({
                    where: jest.fn().mockResolvedValue(categoryRows),
                })),
            })
            .mockReturnValueOnce({
                from: jest.fn(() => ({
                    innerJoin: jest.fn(() => ({
                        where: jest.fn(() => ({
                            groupBy: jest
                                .fn()
                                .mockResolvedValue(contentRowCounts),
                        })),
                    })),
                })),
            });
        const run = jest.fn(() => ({ changes: 1 }));
        const deleteRows = jest.fn(() => ({
            where: jest.fn(() => ({ run })),
        }));
        const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
            callback({ delete: deleteRows })
        );
        const db = { select, transaction } as unknown as AppDatabase;
        const recording = createRecordingOperationPhaseCapture();

        await clearXtreamImportCache(
            db,
            'playlist-1',
            'live',
            recording.capture
        );

        // One row-budgeted content group, then the categories.
        expect(transaction).toHaveBeenCalledTimes(2);
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 355 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
            },
        ]);
    });

    it('emits one zero-count cache-clear pair when no categories exist', async () => {
        const where = jest.fn().mockResolvedValue([]);
        const from = jest.fn(() => ({ where }));
        const select = jest.fn(() => ({ from }));
        const transaction = jest.fn();
        const db = { select, transaction } as unknown as AppDatabase;
        const recording = createRecordingOperationPhaseCapture();

        await expect(
            clearXtreamImportCache(db, 'playlist-1', 'live', recording.capture)
        ).resolves.toEqual({ success: true });

        expect(transaction).not.toHaveBeenCalled();
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 0 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
            },
        ]);
    });
});
