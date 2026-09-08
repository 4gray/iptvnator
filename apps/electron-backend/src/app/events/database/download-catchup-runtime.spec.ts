import { ArchivePartialReplacedError } from './download-catchup-output';
import { handleDownloadFailure } from './download-finalize';
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
import {
    enqueueDownload,
    pauseDownload,
    cancelDownload,
    isDownloadCommitting,
    removeDownloadFromRuntime,
} from './download-runtime';
import { cleanupCatchupFile } from './download-catchup-cleanup';
import { readArchiveFinalizations } from './download-catchup-journal';
import type { DownloadTask } from './download-task';

jest.mock('./download-catchup-cleanup', () => {
    const actual = jest.requireActual('./download-catchup-cleanup');
    return {
        ...actual,
        cleanupCatchupFile: jest.fn(actual.cleanupCatchupFile),
    };
});
jest.mock('./download-catchup-journal', () => ({
    recordArchiveFinalization: jest.fn().mockResolvedValue(undefined),
    recordArchiveCleanupPath: jest.fn(),
    clearArchiveFinalization: jest.fn().mockResolvedValue(undefined),
    readArchiveFinalizations: jest.fn().mockResolvedValue(new Map()),
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
                expect(active.catchupExpectedPartialIdentity).toEqual(
                    expect.objectContaining({
                        dev: active.catchupPartialIdentity.dev,
                        ino: active.catchupPartialIdentity.ino,
                    })
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
            task.filePath = join(directory, 'show.ts');
            await writeFile(task.filePath + '.part', 'retained archive');
            const partial = await lstat(task.filePath + '.part');
            jest.mocked(readArchiveFinalizations).mockResolvedValueOnce(
                new Map([
                    [
                        task.id,
                        {
                            version: 1,
                            filePath: task.filePath,
                            size: partial.size,
                            partialIdentity: partial,
                            finalIdentity: partial,
                        },
                    ],
                ])
            );
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
        const lateCommands: boolean[] = [];
        jest.mocked(cleanupCatchupFile).mockImplementationOnce(
            async (path, identity) => {
                // The file is verified, but cleanup is still awaiting filesystem I/O.
                expect(path).toBe(task.filePath + '.part');
                lateCommands.push(await pauseDownload(task.id));
                lateCommands.push(await cancelDownload(task.id));
                expect(isDownloadCommitting(task.id)).toBe(true);
                lateCommands.push(removeDownloadFromRuntime(task.id));
                expect(task.pauseRequested).not.toBe(true);
                expect(task.cancelRequested).not.toBe(true);
                return jest
                    .requireActual<typeof import('./download-catchup-cleanup')>(
                        './download-catchup-cleanup'
                    )
                    .cleanupCatchupFile(path, identity);
            }
        );
        try {
            if (totalBytes === null) {
                task.filePath = join(directory, 'show.ts');
                await writeFile(
                    task.filePath + '.part',
                    'unproven retained file'
                );
            }
            enqueueDownload(task);
            await settled;
            await new Promise((resolve) => setImmediate(resolve));
            expect(lateCommands).toEqual([false, false, false]);
            expect(terminalStatus).toBe('completed');
            expect(completionAttempts).toBe(2);
            expect(await readFile(task.filePath!)).toEqual(body);
            if (totalBytes === null) {
                expect(task.filePath).toBe(join(directory, 'show (1).ts'));
                expect(
                    await readFile(join(directory, 'show.ts.part'), 'utf8')
                ).toBe('unproven retained file');
            }
            await expect(lstat(task.filePath + '.part')).rejects.toMatchObject({
                code: 'ENOENT',
            });
            expect(transferCatchupToPartialFile).toHaveBeenCalledTimes(1);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
);

it('detaches a rejected replacement so Retry can reserve a fresh path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'archive-detached-'));
    const filePath = join(directory, 'show.ts');
    const task: DownloadTask = {
        id: 994,
        directory,
        filePath,
        fileName: 'show.ts',
        url: 'https://provider.test/show.ts',
        catchup: {
            channelName: 'News',
            startTimestamp: 100,
            stopTimestamp: 200,
        },
    };
    const updates: Record<string, unknown>[] = [];
    const db = {
        update: () => ({
            set: (value: Record<string, unknown>) => ({
                where: async () => {
                    updates.push(value);
                },
            }),
        }),
    };
    try {
        await writeFile(filePath + '.part', 'unrelated user file');
        await handleDownloadFailure(
            db as never,
            task,
            undefined,
            new ArchivePartialReplacedError()
        );
        expect(updates.at(-1)).toEqual(
            expect.objectContaining({ status: 'failed', filePath: null })
        );
        expect(await readFile(filePath + '.part', 'utf8')).toBe(
            'unrelated user file'
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it.each([false, true])(
    'paused cancellation honors durable ownership (replaced=%s)',
    async (replaced) => {
        const directory = await mkdtemp(
            join(tmpdir(), 'archive-cancel-owned-')
        );
        const filePath = join(directory, 'show.ts');
        try {
            await writeFile(filePath + '.part', 'owned archive');
            const original = await lstat(filePath + '.part');
            jest.mocked(readArchiveFinalizations).mockResolvedValueOnce(
                new Map([
                    [
                        995,
                        {
                            version: 1,
                            phase: 'transfer',
                            filePath,
                            partialIdentity: original,
                        },
                    ],
                ])
            );
            if (replaced) {
                await rename(filePath + '.part', join(directory, 'original'));
                await writeFile(filePath + '.part', 'unrelated file');
            }
            const updates: Record<string, unknown>[] = [];
            const db = {
                select: () => ({
                    from: () => ({
                        where: () => ({
                            limit: async () => [
                                {
                                    filePath,
                                    status: 'paused',
                                    contentType: 'catchup',
                                },
                            ],
                        }),
                    }),
                }),
                update: () => ({
                    set: (value: Record<string, unknown>) => ({
                        where: async () => {
                            updates.push(value);
                        },
                    }),
                }),
            };
            jest.mocked(getDatabase).mockResolvedValue(db as never);
            await expect(cancelDownload(995)).resolves.toBe(true);
            expect(updates).toContainEqual(
                expect.objectContaining({ status: 'canceled', filePath: null })
            );
            if (replaced)
                expect(await readFile(filePath + '.part', 'utf8')).toBe(
                    'unrelated file'
                );
            else
                await expect(lstat(filePath + '.part')).rejects.toMatchObject({
                    code: 'ENOENT',
                });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
);
