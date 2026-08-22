const mockGetDatabase = jest.fn();
const mockStatSync = jest.fn();
const mockActiveRowIds = jest.fn();
const mockExecFileSync = jest.fn();
const mockBroadcast = jest.fn();

jest.mock('../../database/connection', () => ({
    getDatabase: (...args: unknown[]) => mockGetDatabase(...args),
}));
jest.mock('fs', () => ({
    ...jest.requireActual<typeof import('fs')>('fs'),
    statSync: (...args: unknown[]) => mockStatSync(...args),
}));
jest.mock('child_process', () => ({
    ...jest.requireActual<typeof import('child_process')>('child_process'),
    execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));
jest.mock('../../services/embedded-mpv-recording-tracker', () => ({
    embeddedMpvRecordingTracker: {
        activeRowIds: (...args: unknown[]) => mockActiveRowIds(...args),
    },
}));
jest.mock('./recording-broadcast', () => ({
    broadcastRecordingsUpdate: (...args: unknown[]) => mockBroadcast(...args),
}));

import { reconcileStaleRecordings } from './recording-recovery';

interface StaleRow {
    id: number;
    filePath: string;
    endedAt: string | null;
    ownerPid?: number | null;
}

function mockDb(rows: StaleRow[]) {
    const selectWhere = jest.fn().mockResolvedValue(rows);
    const updateWhere = jest.fn().mockResolvedValue(undefined);
    const updateSet = jest.fn(
        (_patch: {
            status: string;
            fileSizeBytes: number | null;
            endedAt: string;
        }) => ({ where: updateWhere })
    );
    const db = {
        select: jest.fn(() => ({
            from: jest.fn(() => ({ where: selectWhere })),
        })),
        update: jest.fn(() => ({ set: updateSet })),
    };
    mockGetDatabase.mockResolvedValue(db);
    return { updateSet, updateWhere };
}

describe('reconcileStaleRecordings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockActiveRowIds.mockResolvedValue(new Set<number>());
        // A live peer pid resolves to an IPTVnator-looking process name
        // unless a test says otherwise.
        mockExecFileSync.mockReturnValue('iptvnator');
    });

    it('repairs a playable partial as interrupted with its size', async () => {
        const { updateSet } = mockDb([
            { id: 1, filePath: '/rec/a.ts', endedAt: null },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 2048 });

        await reconcileStaleRecordings();

        expect(updateSet).toHaveBeenCalledTimes(1);
        expect(updateSet.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                status: 'interrupted',
                fileSizeBytes: 2048,
            })
        );
        expect(updateSet.mock.calls[0][0].endedAt).toEqual(expect.any(String));
    });

    it('marks absent or empty files as failed', async () => {
        const { updateSet } = mockDb([
            { id: 1, filePath: '/rec/gone.ts', endedAt: null },
            { id: 2, filePath: '/rec/empty.ts', endedAt: null },
        ]);
        mockStatSync.mockImplementationOnce(() => {
            throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        });
        mockStatSync.mockReturnValueOnce({ isFile: () => true, size: 0 });

        await reconcileStaleRecordings();

        expect(updateSet).toHaveBeenCalledTimes(2);
        expect(updateSet.mock.calls[0][0].status).toBe('failed');
        expect(updateSet.mock.calls[0][0].fileSizeBytes).toBeNull();
        expect(updateSet.mock.calls[1][0].status).toBe('failed');
    });

    it('preserves an already-known endedAt', async () => {
        const { updateSet } = mockDb([
            { id: 1, filePath: '/rec/a.ts', endedAt: '2026-08-15T21:58:00Z' },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 10 });

        await reconcileStaleRecordings();

        expect(updateSet.mock.calls[0][0].endedAt).toBe(
            '2026-08-15T21:58:00Z'
        );
    });

    it('leaves rows owned by another live process alone', async () => {
        // IPTVNATOR_ALLOW_MULTIPLE_INSTANCES: the other instance is still
        // writing that file, and its own finalize is guarded on status
        // 'recording' — repairing here would strand the row.
        const { updateSet } = mockDb([
            { id: 1, filePath: '/rec/live.ts', endedAt: null, ownerPid: 4242 },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 2048 });
        const killSpy = jest
            .spyOn(process, 'kill')
            .mockImplementation(() => true);

        await reconcileStaleRecordings();

        expect(killSpy).toHaveBeenCalledWith(4242, 0);
        expect(updateSet).not.toHaveBeenCalled();
        expect(mockBroadcast).not.toHaveBeenCalled();
        killSpy.mockRestore();
    });

    it('repairs a row whose pid was recycled by an unrelated process', async () => {
        // kill(pid, 0) alone would report the recycled pid as a live peer
        // forever; the process-name check breaks that deadlock.
        const { updateSet } = mockDb([
            {
                id: 1,
                filePath: '/rec/stale.ts',
                endedAt: null,
                ownerPid: 4242,
            },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 2048 });
        const killSpy = jest
            .spyOn(process, 'kill')
            .mockImplementation(() => true);
        mockExecFileSync.mockReturnValue('postgres');

        await reconcileStaleRecordings();

        expect(updateSet.mock.calls[0][0].status).toBe('interrupted');
        killSpy.mockRestore();
    });

    it('keeps skipping when the peer process name cannot be read', async () => {
        // Conservative fallback: never repair a row a live peer might own.
        const { updateSet } = mockDb([
            {
                id: 1,
                filePath: '/rec/live.ts',
                endedAt: null,
                ownerPid: 4242,
            },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 2048 });
        const killSpy = jest
            .spyOn(process, 'kill')
            .mockImplementation(() => true);
        mockExecFileSync.mockImplementation(() => {
            throw new Error('ps unavailable');
        });

        await reconcileStaleRecordings();

        expect(updateSet).not.toHaveBeenCalled();
        killSpy.mockRestore();
    });

    it('broadcasts once after repairing rows so a loaded renderer refetches', async () => {
        mockDb([
            { id: 1, filePath: '/rec/a.ts', endedAt: null },
            { id: 2, filePath: '/rec/b.ts', endedAt: null },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 2048 });

        await reconcileStaleRecordings();

        expect(mockBroadcast).toHaveBeenCalledTimes(1);
    });

    it('does not broadcast when nothing needed repair', async () => {
        mockDb([]);

        await reconcileStaleRecordings();

        expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('repairs rows whose owner process is gone', async () => {
        const { updateSet } = mockDb([
            { id: 1, filePath: '/rec/dead.ts', endedAt: null, ownerPid: 4242 },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 2048 });
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
            throw Object.assign(new Error('no such process'), {
                code: 'ESRCH',
            });
        });

        await reconcileStaleRecordings();

        expect(updateSet.mock.calls[0][0].status).toBe('interrupted');
        killSpy.mockRestore();
    });

    it('leaves a row this process is actively tracking alone', async () => {
        // The renderer is interactive before this pass runs: a recording
        // started during bootstrap has ownerPid === process.pid, so only the
        // tracker's own ledger can prove it is live rather than a leftover.
        const { updateSet } = mockDb([
            {
                id: 9,
                filePath: '/rec/live-now.ts',
                endedAt: null,
                ownerPid: process.pid,
            },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 2048 });
        mockActiveRowIds.mockResolvedValue(new Set([9]));

        await reconcileStaleRecordings();

        expect(updateSet).not.toHaveBeenCalled();
    });

    it('repairs its own leftovers from a previous run', async () => {
        const { updateSet } = mockDb([
            {
                id: 1,
                filePath: '/rec/own.ts',
                endedAt: null,
                ownerPid: process.pid,
            },
        ]);
        mockStatSync.mockReturnValue({ isFile: () => true, size: 2048 });

        await reconcileStaleRecordings();

        expect(updateSet.mock.calls[0][0].status).toBe('interrupted');
    });

    it('swallows database failures without throwing', async () => {
        mockGetDatabase.mockRejectedValue(new Error('db down'));
        const consoleSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        await expect(reconcileStaleRecordings()).resolves.toBeUndefined();
        consoleSpy.mockRestore();
    });
});
