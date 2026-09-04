import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';

const mockGetDatabase = jest.fn();
const mockBroadcast = jest.fn();
const mockStatSync = jest.fn();
const mockUnlinkSync = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => mockGetDatabase(...args),
}));
jest.mock('../events/database/recording-broadcast', () => ({
    broadcastRecordingsUpdate: (...args: unknown[]) => mockBroadcast(...args),
}));
jest.mock('node:fs/promises', () => ({
    ...jest.requireActual<typeof import('node:fs/promises')>(
        'node:fs/promises'
    ),
    stat: (...args: unknown[]) => mockStatSync(...args),
    unlink: (...args: unknown[]) => mockUnlinkSync(...args),
}));

import { EmbeddedMpvRecordingTracker } from './embedded-mpv-recording-tracker';

interface DbHarness {
    insertValues: jest.Mock;
    updateSet: jest.Mock;
    updateWhere: jest.Mock;
}

function mockDb(): DbHarness {
    const insertValues = jest
        .fn((_row: Record<string, unknown>) =>
            Promise.resolve({ lastInsertRowid: BigInt(7) })
        )
        .mockResolvedValue({ lastInsertRowid: BigInt(7) });
    const updateWhere = jest.fn().mockResolvedValue(undefined);
    const updateSet = jest.fn((_patch: Record<string, unknown>) => ({
        where: updateWhere,
    }));
    const db = {
        insert: jest.fn(() => ({ values: insertValues })),
        update: jest.fn(() => ({ set: updateSet })),
    };
    mockGetDatabase.mockResolvedValue(db);
    return { insertValues, updateSet, updateWhere };
}

function session(overrides: Partial<EmbeddedMpvSession>): EmbeddedMpvSession {
    return {
        id: 'session-1',
        title: 'Channel One',
        streamUrl: 'http://stream',
        status: 'playing',
        positionSeconds: 0,
        durationSeconds: null,
        volume: 1,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        startedAt: '2026-08-15T21:00:00Z',
        updatedAt: '2026-08-15T21:00:00Z',
        ...overrides,
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const started = (tracker: EmbeddedMpvRecordingTracker) =>
    tracker.onRecordingStarted({
        sessionId: 'session-1',
        targetPath: '/rec/News-20260815-210000.ts',
        fallbackChannelName: 'Channel One',
        metadata: {
            channelName: 'Channel One',
            channelLogoUrl: 'http://logo.png',
            playlistId: 'playlist-a',
            playlistName: 'My provider',
            sourceType: 'm3u',
            epgChannelId: 'channel.one',
            currentProgram: {
                title: 'Evening News',
                start: '2026-08-15T21:00:00Z',
                stop: '2026-08-15T21:45:00Z',
            },
        },
    });

const inactiveSnapshot = (overrides: Partial<EmbeddedMpvSession> = {}) =>
    session({
        recording: {
            active: false,
            targetPath: '/rec/News-20260815-210000.ts',
        },
        ...overrides,
    });

/**
 * Pushes the inactive snapshot and drives the settle window that guards
 * against macOS native-view's optimistic pre-reply state.
 */
async function settleStop(
    tracker: EmbeddedMpvRecordingTracker,
    overrides: Partial<EmbeddedMpvSession> = {}
): Promise<void> {
    jest.useFakeTimers();
    try {
        tracker.observeSnapshot(inactiveSnapshot(overrides));
        await jest.advanceTimersByTimeAsync(1_600);
    } finally {
        jest.useRealTimers();
    }
    await flush();
}

const activeSnapshot = () =>
    session({
        recording: {
            active: true,
            targetPath: '/rec/News-20260815-210000.ts',
            startedAt: '2026-08-15T21:00:01Z',
        },
    });

describe('EmbeddedMpvRecordingTracker', () => {
    let tracker: EmbeddedMpvRecordingTracker;
    let db: DbHarness;

    beforeEach(() => {
        jest.clearAllMocks();
        db = mockDb();
        mockStatSync.mockResolvedValue({ isFile: () => true, size: 1024 });
        mockUnlinkSync.mockResolvedValue(undefined);
        tracker = new EmbeddedMpvRecordingTracker();
    });

    it('inserts a row with the start metadata and broadcasts', async () => {
        started(tracker);
        await flush();

        expect(db.insertValues).toHaveBeenCalledTimes(1);
        expect(db.insertValues.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                status: 'recording',
                sessionId: 'session-1',
                filePath: '/rec/News-20260815-210000.ts',
                channelName: 'Channel One',
                channelLogoUrl: 'http://logo.png',
                playlistId: 'playlist-a',
                playlistName: 'My provider',
                sourceType: 'm3u',
                epgChannelId: 'channel.one',
                programTitle: 'Evening News',
                programStart: '2026-08-15T21:00:00Z',
                programStop: '2026-08-15T21:45:00Z',
            })
        );
        expect(mockBroadcast).toHaveBeenCalledTimes(1);
    });

    it('falls back to the session title when metadata is absent', async () => {
        tracker.onRecordingStarted({
            sessionId: 'session-1',
            targetPath: '/rec/x.ts',
            fallbackChannelName: 'Fallback Channel',
        });
        await flush();
        expect(db.insertValues.mock.calls[0][0].channelName).toBe(
            'Fallback Channel'
        );
    });

    it('finalizes an explicit stop only after mpv acknowledges it', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');
        await flush();

        // addon.stopRecording() only dispatches: statting or unlinking here
        // could hit a file mpv has not flushed yet.
        expect(db.updateSet).not.toHaveBeenCalled();

        await settleStop(tracker);

        expect(db.updateSet).toHaveBeenCalledTimes(1);
        expect(db.updateSet.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                status: 'completed',
                fileSizeBytes: 1024,
            })
        );
        expect(db.updateSet.mock.calls[0][0].endedAt).toEqual(
            expect.any(String)
        );
        // Start + finalize
        expect(mockBroadcast).toHaveBeenCalledTimes(2);
    });

    it('treats an observed active→inactive flip as the auto-stop', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        await settleStop(tracker);
        expect(db.updateSet.mock.calls[0][0].status).toBe('completed');
    });

    it('abandons finalization when a rejected stop revives the recording', async () => {
        // macOS native-view clears recordingActive before dispatching the
        // async property set and restores it if that request is rejected, so
        // the first inactive snapshot is not an acknowledgement.
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');

        jest.useFakeTimers();
        try {
            tracker.observeSnapshot(inactiveSnapshot());
            await jest.advanceTimersByTimeAsync(500);
            // mpv rejected the stop: it is recording again.
            tracker.observeSnapshot(activeSnapshot());
            await jest.advanceTimersByTimeAsync(3_000);
        } finally {
            jest.useRealTimers();
        }
        await flush();

        expect(db.updateSet).not.toHaveBeenCalled();
    });

    it('ignores inactive snapshots while an async start is still settling', async () => {
        started(tracker);
        tracker.observeSnapshot(
            session({
                recording: {
                    active: false,
                    targetPath: '/rec/News-20260815-210000.ts',
                },
            })
        );
        await flush();
        expect(db.updateSet).not.toHaveBeenCalled();
    });

    it('marks a failed async start and unlinks the empty reservation', async () => {
        mockStatSync.mockResolvedValue({ isFile: () => true, size: 0 });
        started(tracker);
        tracker.observeSnapshot(
            session({
                recording: {
                    active: false,
                    targetPath: '/rec/News-20260815-210000.ts',
                    error: 'property unavailable',
                },
            })
        );
        await flush();

        expect(db.updateSet.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                status: 'failed',
                fileSizeBytes: null,
                errorMessage: 'property unavailable',
            })
        );
        expect(mockUnlinkSync).toHaveBeenCalledWith(
            '/rec/News-20260815-210000.ts'
        );
    });

    /**
     * Pushes an error/closed snapshot and drives the teardown flush window
     * that lets the frame-copy helper exit and flush before the stat.
     */
    async function settleTeardown(
        push: () => void,
        advanceMs = 2_600
    ): Promise<void> {
        jest.useFakeTimers();
        try {
            push();
            await jest.advanceTimersByTimeAsync(advanceMs);
        } finally {
            jest.useRealTimers();
        }
        await flush();
    }

    it('finalizes as interrupted when the session errors mid-recording', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        await settleTeardown(() =>
            tracker.observeSnapshot(session({ status: 'error' }))
        );
        expect(db.updateSet.mock.calls[0][0].status).toBe('interrupted');
    });

    it('finalizes as interrupted on the synthetic closed dispose snapshot', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        await settleTeardown(() =>
            tracker.observeSnapshot(
                session({
                    status: 'closed',
                    recording: {
                        active: false,
                        targetPath: '/rec/News-20260815-210000.ts',
                    },
                })
            )
        );
        expect(db.updateSet.mock.calls[0][0].status).toBe('interrupted');
    });

    it('defers the teardown stat until the helper had time to flush', async () => {
        // disposeSession() emits the synthetic snapshot immediately, but the
        // frame-copy helper exits up to ~2 s later — statting right away
        // would persist a truncated size or misread a short capture.
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());

        jest.useFakeTimers();
        try {
            tracker.observeSnapshot(session({ status: 'closed' }));
            await jest.advanceTimersByTimeAsync(2_000);
            // Row must stay 'recording' (recoverable) through the window.
            expect(db.updateSet).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(600);
        } finally {
            jest.useRealTimers();
        }
        await flush();
        expect(db.updateSet.mock.calls[0][0].status).toBe('interrupted');
    });

    it('lets an acknowledged stop finalize as completed despite a dispose', async () => {
        // Stop acknowledged (inactive snapshot, settle pending) and then the
        // player is closed: the recording ended cleanly, so the armed settle
        // timer wins and the row must not be relabelled 'interrupted'.
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');

        jest.useFakeTimers();
        try {
            tracker.observeSnapshot(inactiveSnapshot());
            tracker.observeSnapshot(session({ status: 'closed' }));
            await jest.advanceTimersByTimeAsync(3_000);
        } finally {
            jest.useRealTimers();
        }
        await flush();

        expect(db.updateSet).toHaveBeenCalledTimes(1);
        expect(db.updateSet.mock.calls[0][0].status).toBe('completed');
    });

    it('degrades an interrupted stop to failed when the file is gone', async () => {
        mockStatSync.mockRejectedValue(
            Object.assign(new Error('gone'), { code: 'ENOENT' })
        );
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        await settleTeardown(() =>
            tracker.observeSnapshot(session({ status: 'closed' }))
        );
        expect(db.updateSet.mock.calls[0][0].status).toBe('failed');
    });

    it('keeps the requested status when the file cannot be judged', async () => {
        // Only proven absence may fail the row; a permission/I-O error (or
        // a stat stalled past its deadline) must not brand a likely-good
        // recording on an unreachable mount as failed.
        mockStatSync.mockRejectedValue(
            Object.assign(new Error('denied'), { code: 'EACCES' })
        );
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');
        await settleStop(tracker);

        expect(db.updateSet.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                status: 'completed',
                fileSizeBytes: null,
            })
        );
        expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('is idempotent: only the first finalize writes', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');
        tracker.onRecordingStopped('session-1');
        await settleTeardown(
            () => tracker.observeSnapshot(session({ status: 'closed' })),
            11_000
        );
        expect(db.updateSet).toHaveBeenCalledTimes(1);
    });

    it('serializes a stop that races the pending insert', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');
        await settleStop(tracker);
        expect(db.insertValues).toHaveBeenCalledTimes(1);
        expect(db.updateSet).toHaveBeenCalledTimes(1);
    });

    it('finalizes a stop mpv never acknowledges once the bound elapses', async () => {
        jest.useFakeTimers();
        try {
            started(tracker);
            tracker.observeSnapshot(activeSnapshot());
            tracker.onRecordingStopped('session-1');
            jest.advanceTimersByTime(10_000);
        } finally {
            jest.useRealTimers();
        }
        await flush();
        expect(db.updateSet.mock.calls[0][0].status).toBe('completed');
    });

    it('keeps the file of a recording that went active even when it looks empty', async () => {
        mockStatSync.mockResolvedValue({ isFile: () => true, size: 0 });
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');
        await settleStop(tracker);

        expect(db.updateSet.mock.calls[0][0].status).toBe('failed');
        // Those bytes belong to mpv; only a never-started reservation is
        // cleaned up.
        expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('keeps a settle timer from finalizing a restarted recording', async () => {
        // Stop → immediate restart on the same session: the old entry's
        // settle timer must finalize the OLD row, and the new recording must
        // still finalize on its own stop — session-id-bound finalization
        // used to end the new row and strand the old one in 'recording'.
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');

        jest.useFakeTimers();
        try {
            tracker.observeSnapshot(inactiveSnapshot());
            // Restart before the 1.5 s settle window expires.
            tracker.onRecordingStarted({
                sessionId: 'session-1',
                targetPath: '/rec/News-20260815-213000.ts',
                fallbackChannelName: 'Channel One',
            });
            await jest.advanceTimersByTimeAsync(1_600);

            // Only the old recording finalized.
            expect(db.updateSet).toHaveBeenCalledTimes(1);
            expect(db.updateSet.mock.calls[0][0].status).toBe('completed');

            // The new recording is still tracked: its own stop finalizes it.
            tracker.observeSnapshot(
                session({
                    recording: {
                        active: true,
                        targetPath: '/rec/News-20260815-213000.ts',
                    },
                })
            );
            tracker.observeSnapshot(
                session({
                    recording: {
                        active: false,
                        targetPath: '/rec/News-20260815-213000.ts',
                    },
                })
            );
            await jest.advanceTimersByTimeAsync(1_600);
        } finally {
            jest.useRealTimers();
        }
        await flush();

        expect(db.updateSet).toHaveBeenCalledTimes(2);
        expect(db.insertValues).toHaveBeenCalledTimes(2);
    });

    it('finalizes a replaced recording even when no stop was ever observed', async () => {
        // A new start on the same session replaces the map entry, so
        // snapshots can never again reach the old entry — the replacement
        // itself must arm the finalization.
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());

        jest.useFakeTimers();
        try {
            tracker.onRecordingStarted({
                sessionId: 'session-1',
                targetPath: '/rec/News-20260815-213000.ts',
                fallbackChannelName: 'Channel One',
            });
            await jest.advanceTimersByTimeAsync(1_600);
        } finally {
            jest.useRealTimers();
        }
        await flush();

        expect(db.updateSet).toHaveBeenCalledTimes(1);
        expect(db.updateSet.mock.calls[0][0].status).toBe('completed');
    });

    it('finalizes a recording as interrupted when the stream drops and a reload replaces it', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());

        jest.useFakeTimers();
        try {
            tracker.onRecordingInterrupted('session-1');
            tracker.onRecordingStarted({
                sessionId: 'session-1',
                targetPath: '/rec/News-20260815-213500.ts',
                fallbackChannelName: 'Channel One',
            });
            await jest.advanceTimersByTimeAsync(1_600);
        } finally {
            jest.useRealTimers();
        }
        await flush();

        expect(db.updateSet).toHaveBeenCalledTimes(1);
        expect(db.updateSet.mock.calls[0][0].status).toBe('interrupted');
    });

    it('finalizes an interrupted recording on its own when no reload follows', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());

        jest.useFakeTimers();
        try {
            tracker.onRecordingInterrupted('session-1');
            await jest.advanceTimersByTimeAsync(2_600);
        } finally {
            jest.useRealTimers();
        }
        await flush();

        expect(db.updateSet).toHaveBeenCalledTimes(1);
        expect(db.updateSet.mock.calls[0][0].status).toBe('interrupted');
    });

    it('keeps a finalizing row in the ledger until its update commits', async () => {
        // finalize() removes the entry from the open map immediately, but
        // the row stays persisted as 'recording' until the queued terminal
        // update commits — startup recovery must still see it as live.
        let releaseUpdate!: () => void;
        db.updateWhere.mockReturnValue(
            new Promise<void>((resolve) => {
                releaseUpdate = () => resolve();
            })
        );
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');

        jest.useFakeTimers();
        try {
            tracker.observeSnapshot(inactiveSnapshot());
            await jest.advanceTimersByTimeAsync(1_600);
        } finally {
            jest.useRealTimers();
        }

        // The update is dispatched but not committed: still in the ledger.
        expect(db.updateSet).toHaveBeenCalledTimes(1);
        await expect(tracker.activeRowIds()).resolves.toEqual(new Set([7]));

        releaseUpdate();
        await flush();
        await expect(tracker.activeRowIds()).resolves.toEqual(new Set());
    });

    it('records the owning process so recovery can skip live rows', async () => {
        started(tracker);
        await flush();
        expect(db.insertValues.mock.calls[0][0].ownerPid).toBe(process.pid);
    });

    it('whenSettled resolves once the queued row INSERT committed', async () => {
        // Enrichment relies on this and nothing else: it no longer waits for
        // finalization, so there is no deadline left to race.
        started(tracker);
        await tracker.whenSettled();
        expect(db.insertValues).toHaveBeenCalledTimes(1);
    });

    it('ignores snapshots for sessions without an open recording', async () => {
        tracker.observeSnapshot(activeSnapshot());
        tracker.observeSnapshot(session({ status: 'closed' }));
        await flush();
        expect(db.updateSet).not.toHaveBeenCalled();
        expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('survives a failed insert without finalizing or broadcasting', async () => {
        db.insertValues.mockRejectedValue(new Error('db down'));
        const consoleSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        started(tracker);
        tracker.onRecordingStopped('session-1');
        await flush();
        expect(db.updateSet).not.toHaveBeenCalled();
        expect(mockBroadcast).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});
