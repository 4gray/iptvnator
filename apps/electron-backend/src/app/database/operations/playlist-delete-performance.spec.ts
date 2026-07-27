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

function createDeleteHarness() {
    const timeline: string[] = [];
    const selections = [
        ['select:favorites', [{ id: 1 }, { id: 2 }]],
        ['select:recently-viewed', [{ id: 3 }]],
        ['select:playback-positions', []],
        ['select:downloads', [{ id: 4 }]],
        ['select:categories', [{ id: 10 }, { id: 11 }]],
        [
            'select:content',
            Array.from({ length: 205 }, (_, id) => ({ id: id + 100 })),
        ],
    ] as const;
    const select = jest.fn();
    for (const [label, rows] of selections) {
        select.mockReturnValueOnce(createSelectStep(rows, label, timeline));
    }
    const transactionRun = jest.fn();
    const transactionDelete = jest.fn(() => ({
        where: jest.fn(() => ({ run: transactionRun })),
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

        expect(harness.transaction).toHaveBeenCalledTimes(7);
        // Seven committed chunks plus the final playlist row each keep both
        // the pre-write and post-progress cooperative checkpoints.
        expect(checkpoint).toHaveBeenCalledTimes(16);
        expect(harness.timeline.slice(1, 7)).toEqual([
            'select:favorites',
            'select:recently-viewed',
            'select:playback-positions',
            'select:downloads',
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
                metadata: { itemCount: 211 },
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
            },
            {
                boundary: 'start',
                phase: XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
            },
            {
                boundary: 'end',
                metadata: { itemCount: 212 },
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
