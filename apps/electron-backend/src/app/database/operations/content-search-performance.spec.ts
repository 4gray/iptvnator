import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { searchContent } from './content.operations';
import { createRecordingOperationPhaseCapture } from './performance-phase-capture.test-helpers';

function createSearchDb(query: Promise<unknown[]>) {
    const limit = jest.fn(() => query);
    const where = jest.fn(() => ({ limit }));
    const innerJoin = jest.fn(() => ({ where }));
    const from = jest.fn(() => ({ innerJoin }));
    const select = jest.fn(() => ({ from }));
    return {
        db: { select } as unknown as AppDatabase,
        select,
    };
}

describe('in-playlist search performance phases', () => {
    it('closes query before measuring synchronous filtering and ranking', async () => {
        const candidates = [
            {
                id: 1,
                title: 'News One',
                xtream_id: 101,
                type: 'live',
            },
            {
                id: 2,
                title: 'Movies',
                xtream_id: 102,
                type: 'live',
            },
        ];
        let resolveQuery!: (value: typeof candidates) => void;
        const query = new Promise<typeof candidates>((resolve) => {
            resolveQuery = resolve;
        });
        const { db } = createSearchDb(query);
        const recording = createRecordingOperationPhaseCapture();

        const result = searchContent(
            db,
            'playlist-1',
            'news',
            ['live'],
            false,
            recording.capture
        );
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_SEARCH_QUERY,
            },
        ]);

        resolveQuery(candidates);
        await expect(result).resolves.toEqual([candidates[0]]);
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_SEARCH_QUERY,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 2 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_SEARCH_QUERY,
            },
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_SEARCH_RANK,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 1 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_SEARCH_RANK,
            },
        ]);
    });

    it('closes a rejected query without starting rank and preserves identity', async () => {
        const queryError = new Error('search query failed');
        const { db } = createSearchDb(Promise.reject(queryError));
        const recording = createRecordingOperationPhaseCapture();

        await expect(
            searchContent(
                db,
                'playlist-1',
                'news',
                ['live'],
                false,
                recording.capture
            )
        ).rejects.toBe(queryError);
        expect(recording.events).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_SEARCH_QUERY,
            },
            {
                boundary: 'end',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_SEARCH_QUERY,
            },
        ]);
    });

    it('keeps invalid input as zero-work with no query or phases', async () => {
        const { db, select } = createSearchDb(Promise.resolve([]));
        const recording = createRecordingOperationPhaseCapture();

        await expect(
            searchContent(
                db,
                'playlist-1',
                '',
                ['live'],
                false,
                recording.capture
            )
        ).resolves.toEqual([]);
        expect(select).not.toHaveBeenCalled();
        expect(recording.events).toEqual([]);
    });
});
