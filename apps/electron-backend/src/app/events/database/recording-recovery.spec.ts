const mockGetDatabase = jest.fn();
const mockStatSync = jest.fn();

jest.mock('../../database/connection', () => ({
    getDatabase: (...args: unknown[]) => mockGetDatabase(...args),
}));
jest.mock('fs', () => ({
    ...jest.requireActual<typeof import('fs')>('fs'),
    statSync: (...args: unknown[]) => mockStatSync(...args),
}));

import { reconcileStaleRecordings } from './recording-recovery';

interface StaleRow {
    id: number;
    filePath: string;
    endedAt: string | null;
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

    it('swallows database failures without throwing', async () => {
        mockGetDatabase.mockRejectedValue(new Error('db down'));
        const consoleSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        await expect(reconcileStaleRecordings()).resolves.toBeUndefined();
        consoleSpy.mockRestore();
    });
});
