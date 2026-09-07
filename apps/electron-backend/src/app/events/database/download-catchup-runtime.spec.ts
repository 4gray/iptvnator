import {
    lstat,
    mkdtemp,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDatabase } from '../../database/connection';
import { transferCatchupToPartialFile } from './download-catchup-transfer';
import { enqueueDownload } from './download-runtime';
import type { DownloadTask } from './download-task';

jest.mock('./download-catchup-journal', () => ({
    recordArchiveFinalization: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../database/connection', () => ({ getDatabase: jest.fn() }));
jest.mock('./download-catchup-transfer', () => ({
    transferCatchupToPartialFile: jest.fn(),
}));
jest.mock('./download-broadcast', () => ({
    broadcastDownloadUpdate: jest.fn(),
}));
beforeEach(() => jest.mocked(transferCatchupToPartialFile).mockReset());

it.each(['failed', 'canceled'])(
    'preserves a replaced partial when the active archive becomes %s',
    async (status) => {
        const directory = await mkdtemp(join(tmpdir(), 'archive-runtime-'));
        const task: DownloadTask = {
            id: 991,
            directory,
            fileName: 'show.ts',
            url: 'https://provider.test/show.ts',
            catchup: {
                channelName: 'News',
                startTimestamp: 100,
                stopTimestamp: 200,
            },
        };
        let done!: () => void;
        const completed = new Promise<void>((resolve) => {
            done = resolve;
        });
        const updates: Record<string, unknown>[] = [];
        const db = {
            update: () => ({
                set: (value: Record<string, unknown>) => ({
                    where: async () => {
                        updates.push(value);
                        if (value.status === status) done();
                    },
                }),
            }),
        };
        jest.mocked(getDatabase).mockResolvedValue(db as never);
        jest.mocked(transferCatchupToPartialFile).mockImplementationOnce(
            async (_db, active, reservation) => {
                active.catchupPartialIdentity = await lstat(
                    reservation.partialPath
                );
                await rename(
                    reservation.partialPath,
                    join(directory, 'original')
                );
                await writeFile(reservation.partialPath, 'keep replacement');
                if (status === 'canceled') active.cancelRequested = true;
                throw new Error('transfer interrupted');
            }
        );
        const errorLog = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            enqueueDownload(task);
            await completed;
            // Let the queue's finally block retire this task before the next case.
            await new Promise((resolve) => setImmediate(resolve));
            expect(
                await readFile(join(directory, 'show.ts.part'), 'utf8')
            ).toBe('keep replacement');
            expect(
                updates.some((update) => update.status === 'completed')
            ).toBe(false);
            expect(updates.at(-1)).toEqual(
                expect.objectContaining({
                    status,
                    filePath: join(directory, 'show.ts'),
                })
            );
        } finally {
            errorLog.mockRestore();
            await rm(directory, { recursive: true, force: true });
        }
    }
);

it.each([1880, null])(
    'recovers a verified archive after one completion-write failure (response length %s)',
    async (totalBytes) => {
        const directory = await mkdtemp(join(tmpdir(), 'archive-persistence-'));
        const body = Buffer.alloc(1880, 0x47);
        const task: DownloadTask = {
            id: 992,
            directory,
            fileName: 'show.ts',
            url: 'https://provider.test/show.ts',
            catchup: {
                channelName: 'News',
                startTimestamp: 100,
                stopTimestamp: 200,
            },
        };
        let done!: () => void;
        const settled = new Promise<void>((resolve) => {
            done = resolve;
        });
        let completionAttempts = 0;
        let terminalStatus: unknown;
        const db = {
            update: () => ({
                set: (value: Record<string, unknown>) => ({
                    where: async () => {
                        if (
                            value.status === 'completed' &&
                            ++completionAttempts === 1
                        )
                            throw new Error('SQLITE_BUSY');
                        if (
                            value.status === 'completed' ||
                            value.status === 'failed'
                        ) {
                            terminalStatus = value.status;
                            done();
                        }
                    },
                }),
            }),
        };
        jest.mocked(getDatabase).mockResolvedValue(db as never);
        jest.mocked(transferCatchupToPartialFile).mockImplementationOnce(
            async (_db, active, reservation) => {
                await writeFile(reservation.partialPath, body);
                active.catchupPartialIdentity = await lstat(
                    reservation.partialPath
                );
                active.totalBytes = totalBytes;
                return {
                    bytesDownloaded: body.length,
                    totalBytes: body.length,
                };
            }
        );
        try {
            enqueueDownload(task);
            await settled;
            await new Promise((resolve) => setImmediate(resolve));
            expect(terminalStatus).toBe('completed');
            expect(completionAttempts).toBe(2);
            expect(await readFile(join(directory, 'show.ts'))).toEqual(body);
            await expect(
                lstat(join(directory, 'show.ts.part'))
            ).rejects.toMatchObject({ code: 'ENOENT' });
            expect(transferCatchupToPartialFile).toHaveBeenCalledTimes(1);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
);
