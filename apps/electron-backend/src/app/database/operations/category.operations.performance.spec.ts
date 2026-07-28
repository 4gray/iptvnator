import type { AppDatabase } from '../database.types';
import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import { getCategories, saveCategories } from './category.operations';
import { createRecordingOperationPhaseCapture } from './performance-phase-capture.test-helpers';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('category operation performance phases', () => {
    it('keeps the categories read phase open until the query resolves', async () => {
        const rows = [{ id: 1, name: 'News' }];
        const pending = createDeferred<typeof rows>();
        const orderBy = jest.fn(() => pending.promise);
        const where = jest.fn(() => ({ orderBy }));
        const from = jest.fn(() => ({ where }));
        const db = {
            select: jest.fn(() => ({ from })),
        } as unknown as AppDatabase;
        const recording = createRecordingOperationPhaseCapture();

        const result = getCategories(
            db,
            'playlist-1',
            'live',
            recording.capture
        );

        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_READ,
            },
        ]);

        pending.resolve(rows);
        await expect(result).resolves.toBe(rows);
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_READ,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 1 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_READ,
            },
        ]);
    });

    it('captures normalization and the existing category write separately', async () => {
        const existingWhere = jest.fn().mockResolvedValue([{ count: 0 }]);
        const select = jest.fn(() => ({
            from: jest.fn(() => ({ where: existingWhere })),
        }));
        const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
        const values = jest.fn(() => ({ onConflictDoNothing }));
        const insert = jest.fn(() => ({ values }));
        const db = { insert, select } as unknown as AppDatabase;
        const recording = createRecordingOperationPhaseCapture();

        await expect(
            saveCategories(
                db,
                'playlist-1',
                [
                    { category_name: 'News', category_id: '101' },
                    { category_name: 'Broken', category_id: 'not-a-number' },
                    { category_name: 'Sports', category_id: 102 },
                ],
                'live',
                [102],
                recording.capture
            )
        ).resolves.toEqual({ success: true });

        expect(values).toHaveBeenCalledWith([
            expect.objectContaining({ name: 'News', xtreamId: 101 }),
            expect.objectContaining({
                hidden: true,
                name: 'Sports',
                xtreamId: 102,
            }),
        ]);
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_CATEGORIES,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 2 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_CATEGORIES,
            },
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 2 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
            },
        ]);
    });
});
