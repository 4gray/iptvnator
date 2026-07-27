import type {
    AppPlaylistGetPerformancePhase,
    PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';
import {
    APP_PLAYLIST_GET_PERFORMANCE_PHASE,
} from '@iptvnator/shared/interfaces';

import type { AppDatabase } from '../database.types';
import { getAppPlaylist } from './playlist.operations';

type TestGetPhaseCapture = {
    captureAsync: <TResult>(
        phase: AppPlaylistGetPerformancePhase,
        execute: () => Promise<TResult>,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => Promise<TResult>;
    captureSync: <TResult>(
        phase: AppPlaylistGetPerformancePhase,
        execute: () => TResult,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => TResult;
};

function createDatabaseMock(rows: unknown[]) {
    const limit = jest.fn().mockResolvedValue(rows);
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));

    return {
        db: { select } as unknown as AppDatabase,
        from,
        limit,
        select,
        where,
    };
}

const playlistRow = {
    id: 'synthetic-playlist',
    name: 'Synthetic playlist',
    type: 'm3u-url',
    payload: JSON.stringify({
        _id: 'synthetic-playlist',
        playlist: {
            items: [{ id: 'channel-1' }, { id: 'channel-2' }],
        },
        title: 'Synthetic playlist',
    }),
    favorites: null,
    recentlyViewed: null,
} as never;

describe('app playlist GET performance boundaries', () => {
    it('keeps the default read and parse path unchanged', async () => {
        const { db, limit, select } = createDatabaseMock([playlistRow]);

        await expect(
            getAppPlaylist(db, 'synthetic-playlist')
        ).resolves.toEqual(
            expect.objectContaining({
                _id: 'synthetic-playlist',
                playlist: {
                    items: [{ id: 'channel-1' }, { id: 'channel-2' }],
                },
            })
        );
        expect(select).toHaveBeenCalledTimes(1);
        expect(limit).toHaveBeenCalledWith(1);
    });

    it('separates the awaited SQLite read from playlist deserialization', async () => {
        const { db, limit } = createDatabaseMock([playlistRow]);
        const phases: Array<{
            metadata: PerformancePhaseMetadata | undefined;
            phase: AppPlaylistGetPerformancePhase;
        }> = [];
        const capture: TestGetPhaseCapture = {
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
        const getWithCapture = getAppPlaylist as unknown as (
            database: AppDatabase,
            playlistId: string,
            phaseCapture: TestGetPhaseCapture
        ) => Promise<Record<string, unknown> | null>;

        await expect(
            getWithCapture(db, 'synthetic-playlist', capture)
        ).resolves.toEqual(
            expect.objectContaining({
                _id: 'synthetic-playlist',
            })
        );

        expect(phases).toEqual([
            {
                metadata: { itemCount: 1 },
                phase: APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
            },
            {
                metadata: { itemCount: 2 },
                phase: APP_PLAYLIST_GET_PERFORMANCE_PHASE.DESERIALIZE_PLAYLIST,
            },
        ]);
        expect(limit).toHaveBeenCalledTimes(1);
    });
});
