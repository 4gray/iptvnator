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
jest.mock('fs', () => ({
    ...jest.requireActual<typeof import('fs')>('fs'),
    statSync: (...args: unknown[]) => mockStatSync(...args),
    unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
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
        mockStatSync.mockReturnValue({ isFile: () => true, size: 1024 });
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

    it('finalizes an explicit stop as completed with the file size', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');
        await flush();

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
        tracker.observeSnapshot(
            session({
                recording: {
                    active: false,
                    targetPath: '/rec/News-20260815-210000.ts',
                },
            })
        );
        await flush();
        expect(db.updateSet.mock.calls[0][0].status).toBe('completed');
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
        mockStatSync.mockReturnValue({ isFile: () => true, size: 0 });
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

    it('finalizes as interrupted when the session errors mid-recording', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.observeSnapshot(session({ status: 'error' }));
        await flush();
        expect(db.updateSet.mock.calls[0][0].status).toBe('interrupted');
    });

    it('finalizes as interrupted on the synthetic closed dispose snapshot', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.observeSnapshot(
            session({
                status: 'closed',
                recording: {
                    active: false,
                    targetPath: '/rec/News-20260815-210000.ts',
                },
            })
        );
        await flush();
        expect(db.updateSet.mock.calls[0][0].status).toBe('interrupted');
    });

    it('degrades an interrupted stop to failed when the file is gone', async () => {
        mockStatSync.mockImplementation(() => {
            throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        });
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.observeSnapshot(session({ status: 'closed' }));
        await flush();
        expect(db.updateSet.mock.calls[0][0].status).toBe('failed');
    });

    it('is idempotent: only the first finalize writes', async () => {
        started(tracker);
        tracker.observeSnapshot(activeSnapshot());
        tracker.onRecordingStopped('session-1');
        tracker.onRecordingStopped('session-1');
        tracker.observeSnapshot(session({ status: 'closed' }));
        await flush();
        expect(db.updateSet).toHaveBeenCalledTimes(1);
    });

    it('serializes a stop that races the pending insert', async () => {
        started(tracker);
        tracker.onRecordingStopped('session-1');
        await flush();
        expect(db.insertValues).toHaveBeenCalledTimes(1);
        expect(db.updateSet).toHaveBeenCalledTimes(1);
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
