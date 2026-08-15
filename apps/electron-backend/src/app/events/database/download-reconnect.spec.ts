import { transferWithReconnects } from './download-reconnect';
import type { ReservedPartialDownloadFile } from './download-file-path';
import type { DownloadsDatabase, DownloadTask } from './download-task';
import {
    InterruptedTransferError,
    TruncatedTransferError,
} from './download-transfer';

jest.mock('./download-file-path', () => ({
    getPartialDownloadSize: jest.fn(() => 0),
}));

import { getPartialDownloadSize } from './download-file-path';

const mockedPartialSize = getPartialDownloadSize as jest.Mock;

const db = {} as DownloadsDatabase;
const reservation: ReservedPartialDownloadFile = {
    filename: 'movie.mp4',
    partialPath: '/downloads/movie.mp4.part',
    path: '/downloads/movie.mp4',
};

function createTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
    return {
        directory: '/downloads',
        fileName: 'movie.mp4',
        id: 7,
        url: 'https://example.test/movie.mp4',
        ...overrides,
    };
}

function interrupted(bytesDownloaded: number): InterruptedTransferError {
    return new InterruptedTransferError(
        { bytesDownloaded, totalBytes: 1_000_000 },
        'ECONNRESET'
    );
}

describe('transferWithReconnects', () => {
    let consoleWarn: jest.SpyInstance;

    beforeEach(() => {
        mockedPartialSize.mockReturnValue(0);
        consoleWarn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleWarn.mockRestore();
        jest.clearAllMocks();
    });

    it('returns the first successful transfer without reconnecting', async () => {
        const transfer = jest
            .fn()
            .mockResolvedValue({ bytesDownloaded: 10, totalBytes: 10 });

        const progress = await transferWithReconnects(
            db,
            createTask(),
            reservation,
            { delayMs: 0, transfer }
        );

        expect(progress).toEqual({ bytesDownloaded: 10, totalBytes: 10 });
        expect(transfer).toHaveBeenCalledTimes(1);
    });

    it('reconnects through progressing interruptions until the transfer completes', async () => {
        const transfer = jest
            .fn()
            .mockRejectedValueOnce(interrupted(200_000))
            .mockRejectedValueOnce(interrupted(500_000))
            .mockResolvedValue({
                bytesDownloaded: 1_000_000,
                totalBytes: 1_000_000,
            });

        const progress = await transferWithReconnects(
            db,
            createTask(),
            reservation,
            { delayMs: 0, transfer }
        );

        expect(progress.bytesDownloaded).toBe(1_000_000);
        expect(transfer).toHaveBeenCalledTimes(3);
    });

    it('reconnects through a clean short response the same way', async () => {
        const transfer = jest
            .fn()
            .mockRejectedValueOnce(
                new TruncatedTransferError({
                    bytesDownloaded: 300_000,
                    totalBytes: 1_000_000,
                })
            )
            .mockResolvedValue({
                bytesDownloaded: 1_000_000,
                totalBytes: 1_000_000,
            });

        await transferWithReconnects(db, createTask(), reservation, {
            delayMs: 0,
            transfer,
        });

        expect(transfer).toHaveBeenCalledTimes(2);
    });

    it('surfaces the interruption after consecutive attempts without progress', async () => {
        const transfer = jest.fn().mockRejectedValue(interrupted(0));

        await expect(
            transferWithReconnects(db, createTask(), reservation, {
                delayMs: 0,
                transfer,
            })
        ).rejects.toBeInstanceOf(InterruptedTransferError);
        // The first interruption earns a reconnect unconditionally; the next
        // three burn the stall budget.
        expect(transfer).toHaveBeenCalledTimes(4);
    });

    it('resets the stall budget whenever an attempt makes real progress', async () => {
        const transfer = jest
            .fn()
            .mockRejectedValueOnce(interrupted(100_000))
            .mockRejectedValueOnce(interrupted(100_000))
            .mockRejectedValueOnce(interrupted(300_000))
            .mockRejectedValueOnce(interrupted(300_000))
            .mockRejectedValueOnce(interrupted(300_000))
            .mockRejectedValue(interrupted(300_000));

        await expect(
            transferWithReconnects(db, createTask(), reservation, {
                delayMs: 0,
                transfer,
            })
        ).rejects.toBeInstanceOf(InterruptedTransferError);
        // First attempt free, 100k stall, 300k progress resets, 3 stalls.
        expect(transfer).toHaveBeenCalledTimes(6);
    });

    it('ignores sub-threshold progress when counting stalled attempts', async () => {
        const transfer = jest
            .fn()
            .mockRejectedValueOnce(interrupted(10_000))
            .mockRejectedValueOnce(interrupted(20_000))
            .mockRejectedValue(interrupted(30_000));

        await expect(
            transferWithReconnects(db, createTask(), reservation, {
                delayMs: 0,
                transfer,
            })
        ).rejects.toBeInstanceOf(InterruptedTransferError);
        expect(transfer).toHaveBeenCalledTimes(4);
    });

    it('rethrows immediately when cancel or pause was requested', async () => {
        const task = createTask();
        const transfer = jest.fn().mockImplementation(async () => {
            task.cancelRequested = true;
            throw interrupted(500_000);
        });

        await expect(
            transferWithReconnects(db, task, reservation, {
                delayMs: 0,
                transfer,
            })
        ).rejects.toBeInstanceOf(InterruptedTransferError);
        expect(transfer).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-network errors without reconnecting', async () => {
        const transfer = jest
            .fn()
            .mockRejectedValue(
                new Error('Server returned an invalid resume range')
            );

        await expect(
            transferWithReconnects(db, createTask(), reservation, {
                delayMs: 0,
                transfer,
            })
        ).rejects.toThrow('Server returned an invalid resume range');
        expect(transfer).toHaveBeenCalledTimes(1);
    });

    it('converts a refused reconnect into a retained interruption instead of losing the partial', async () => {
        mockedPartialSize.mockReturnValue(400_000);
        const refused = new Error(
            'connect ECONNREFUSED'
        ) as NodeJS.ErrnoException;
        refused.code = 'ECONNREFUSED';
        const transfer = jest.fn().mockRejectedValue(refused);

        await expect(
            transferWithReconnects(
                db,
                createTask({ totalBytes: 1_000_000 }),
                reservation,
                { delayMs: 0, transfer }
            )
        ).rejects.toMatchObject({
            message: expect.stringContaining(
                'DOWNLOAD_NETWORK_INTERRUPTED (ECONNREFUSED)'
            ),
        });
        expect(transfer).toHaveBeenCalledTimes(4);
    });

    it('does not convert a request failure when nothing is on disk yet', async () => {
        mockedPartialSize.mockReturnValue(0);
        const refused = new Error(
            'connect ECONNREFUSED'
        ) as NodeJS.ErrnoException;
        refused.code = 'ECONNREFUSED';
        const transfer = jest.fn().mockRejectedValue(refused);

        await expect(
            transferWithReconnects(
                db,
                createTask({ totalBytes: 1_000_000 }),
                reservation,
                { delayMs: 0, transfer }
            )
        ).rejects.toBe(refused);
        expect(transfer).toHaveBeenCalledTimes(1);
    });
});
