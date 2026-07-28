import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { createRecordingOperationPhaseCapture } from './performance-phase-capture.test-helpers';
import { deleteXtreamContent } from './xtream.operations';

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
    const content = Array.from({ length: 205 }, (_, id) => ({ id: id + 1 }));
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
            createSelectStep(content, 'select:content', timeline)
        );
    const run = jest.fn();
    const deleteRows = jest.fn(() => ({
        where: jest.fn(() => ({ run })),
    }));
    const transaction = jest.fn((execute: (tx: unknown) => unknown) => {
        timeline.push('transaction');
        return execute({ delete: deleteRows });
    });

    return {
        content,
        db: { select, transaction } as unknown as AppDatabase,
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
        const onProgress = jest.fn((progress: { current?: number }) => {
            harness.timeline.push(`progress:${progress.current}`);
        });

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

        expect(harness.transaction).toHaveBeenCalledTimes(4);
        // Existing progress reporting performs a second cooperative
        // checkpoint after each committed batch.
        expect(checkpoint).toHaveBeenCalledTimes(8);
        expect(onProgress.mock.calls.map(([value]) => value.current)).toEqual([
            100, 200, 205, 2,
        ]);
        expect(harness.timeline.slice(1, 5)).toEqual([
            'select:categories',
            'select:favorites',
            'select:recently-viewed',
            'select:content',
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
