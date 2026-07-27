import {
    APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE,
    type AppPlaylistUpsertPerformancePhase,
    type PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';

import type { AppDatabase } from '../database.types';
import {
    type AppPlaylistUpsertPhaseCapture,
    upsertAppPlaylist,
} from './playlist.operations';

function createDatabaseMock(runImplementation: () => unknown = () => ({})) {
    const run = jest.fn(runImplementation);
    const then = jest.fn(
        (
            onFulfilled: (value: unknown) => unknown,
            onRejected: (error: unknown) => unknown
        ) => Promise.resolve().then(run).then(onFulfilled, onRejected)
    );
    const onConflictDoUpdate = jest.fn(() => ({ run, then }));
    const values = jest.fn(() => ({ onConflictDoUpdate }));
    const insert = jest.fn(() => ({ values }));

    return {
        db: { insert } as unknown as AppDatabase,
        insert,
        onConflictDoUpdate,
        run,
        values,
    };
}

describe('app playlist upsert performance boundaries', () => {
    const playlist = {
        _id: 'synthetic-playlist',
        playlist: {
            items: [{ id: 'channel-1' }, { id: 'channel-2' }],
        },
        title: 'Synthetic playlist',
        type: 'm3u-url',
        url: 'http://127.0.0.1:43210/synthetic-performance.m3u',
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('keeps the default path free of phase hooks and executes one autocommit run', async () => {
        const { db, run } = createDatabaseMock();

        await expect(upsertAppPlaylist(db, playlist)).resolves.toEqual({
            success: true,
        });
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('separates row/JSON serialization from SQLite without rescanning the payload for metadata', async () => {
        const { db, run } = createDatabaseMock();
        const byteLength = jest.spyOn(Buffer, 'byteLength');
        const phases: Array<{
            metadata: PerformancePhaseMetadata | undefined;
            phase: AppPlaylistUpsertPerformancePhase;
        }> = [];
        const capture: AppPlaylistUpsertPhaseCapture = {
            async captureAsync(phase, execute, metadata) {
                const result = await execute();
                phases.push({
                    metadata: metadata?.(result),
                    phase,
                });
                return result;
            },
            captureSync(phase, execute, metadata) {
                const result = execute();
                phases.push({
                    metadata: metadata?.(result),
                    phase,
                });
                return result;
            },
        };

        await expect(upsertAppPlaylist(db, playlist, capture)).resolves.toEqual(
            { success: true }
        );

        expect(phases).toEqual([
            {
                metadata: { itemCount: 2 },
                phase: APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
            },
            {
                metadata: { itemCount: 1 },
                phase: APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
            },
        ]);
        expect(byteLength).not.toHaveBeenCalled();
        expect(run).toHaveBeenCalledTimes(1);
    });
});
