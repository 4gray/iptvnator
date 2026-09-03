import * as schema from '@iptvnator/shared/database/schema';
import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { createRecordingOperationPhaseCapture } from './performance-phase-capture.test-helpers';
import { deletePlaylist } from './playlist.operations';

function createSelectStep(
    rows: readonly unknown[],
    label: string,
    timeline: string[]
) {
    const where = jest.fn(() => {
        timeline.push(label);
        return Promise.resolve(rows);
    });
    const from = jest.fn(() => ({ where }));
    return { from };
}

/** The grouped per-category content count query. */
function createCountStep(
    rows: readonly unknown[],
    label: string,
    timeline: string[]
) {
    const groupBy = jest.fn(() => {
        timeline.push(label);
        return Promise.resolve(rows);
    });
    const where = jest.fn(() => ({ groupBy }));
    const innerJoin = jest.fn(() => ({ where }));
    const from = jest.fn(() => ({ innerJoin }));
    return { from };
}

const ROWS_PER_TABLE = new Map<unknown, number>([
    [schema.favorites, 2],
    [schema.recentlyViewed, 1],
    [schema.playbackPositions, 0],
    [schema.content, 205],
    [schema.categories, 2],
]);

function createDeleteHarness() {
    const timeline: string[] = [];
    const select = jest
        .fn()
        .mockReturnValueOnce(
            createSelectStep([{ count: 2 }], 'select:favorites', timeline)
        )
        .mockReturnValueOnce(
            createSelectStep(
                [{ count: 1 }],
                'select:recently-viewed',
                timeline
            )
        )
        .mockReturnValueOnce(
            createSelectStep(
                [{ count: 0 }],
                'select:playback-positions',
                timeline
            )
        )
        .mockReturnValueOnce(
            createSelectStep(
                [{ id: 10 }, { id: 11 }],
                'select:categories',
                timeline
            )
        )
        .mockReturnValueOnce(
            createCountStep(
                [
                    { categoryId: 10, rowCount: 120 },
                    { categoryId: 11, rowCount: 85 },
                ],
                'select:content',
                timeline
            )
        );
    const transactionDelete = jest.fn((table: unknown) => ({
        where: jest.fn(() => ({
            run: jest.fn(() => ({ changes: ROWS_PER_TABLE.get(table) ?? 0 })),
        })),
    }));
    const transaction = jest.fn((execute: (tx: unknown) => unknown) => {
        timeline.push('transaction');
        return execute({ delete: transactionDelete });
    });
    const playlistWhere = jest.fn(() => {
        timeline.push('delete:playlist');
        return Promise.resolve(undefined);
    });
    const deletePlaylistRow = jest.fn(() => ({ where: playlistWhere }));

    return {
        db: {
            delete: deletePlaylistRow,
            select,
            transaction,
        } as unknown as AppDatabase,
        timeline,
        transaction,
    };
}

describe('playlist delete performance phases', () => {
    it('counts collected dependent IDs and includes the final playlist row in writes', async () => {
        const harness = createDeleteHarness();
        const recording = createRecordingOperationPhaseCapture((event) => {
            harness.timeline.push(`${event.phase}:${event.boundary}`);
        });
        const checkpoint = jest.fn(() => {
            harness.timeline.push('checkpoint');
        });
        const onProgress = jest.fn((progress: { phase: string }) => {
            harness.timeline.push(`progress:${progress.phase}`);
        });

        await expect(
            deletePlaylist(
                harness.db,
                'playlist-1',
                { checkpoint, onProgress },
                recording.capture
            )
        ).resolves.toEqual({ success: true });

        // Favorites, recently viewed, one row-budgeted content group and the
        // categories commit once each; the empty playback-position stage is
        // skipped.
        expect(harness.transaction).toHaveBeenCalledTimes(4);
        // Four committed stages plus the final playlist row each keep both
        // the pre-write and post-progress cooperative checkpoints.
        expect(checkpoint).toHaveBeenCalledTimes(10);
        expect(onProgress.mock.calls.map(([value]) => value.phase)).toEqual([
            'deleting-favorites',
            'deleting-recently-viewed',
            'deleting-content',
            'deleting-categories',
            'deleting-playlist',
        ]);
        expect(harness.timeline.slice(1, 6)).toEqual([
            'select:favorites',
            'select:recently-viewed',
            'select:playback-positions',
            'select:categories',
            'select:content',
        ]);
        const writeStart = harness.timeline.indexOf(
            'sqlite.playlist-delete.write-transactions:start'
        );
        const writeEnd = harness.timeline.indexOf(
            'sqlite.playlist-delete.write-transactions:end'
        );
        expect(harness.timeline.indexOf('delete:playlist')).toBeGreaterThan(
            writeStart
        );
        expect(writeEnd).toBeGreaterThan(
            harness.timeline.indexOf('progress:deleting-playlist')
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
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 210 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
            },
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 211 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
            },
        ]);
    });

    it('closes the write phase on cancellation before deleting the playlist row', async () => {
        const harness = createDeleteHarness();
        const recording = createRecordingOperationPhaseCapture();
        const cancellation = new Error('synthetic cancellation');
        cancellation.name = 'AbortError';
        let checkpointCount = 0;

        await expect(
            deletePlaylist(
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
        expect(harness.timeline).not.toContain('delete:playlist');
        expect(recording.events.at(-1)).toEqual({
            boundary: 'end',
            phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
        });
    });
});
