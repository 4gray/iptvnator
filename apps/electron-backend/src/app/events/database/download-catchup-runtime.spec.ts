import { unlinkSync } from 'node:fs';
import { cleanupStoredCatchupPartial } from './download-catchup-removal';
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
    prepareArchiveRemoval,
    hasRuntimeDownload,
} from './download-runtime';
import {
    readArchiveFinalizations,
    recordArchiveCleanupPath,
    type ArchiveDownloadProof,
} from './download-catchup-journal';
import type { DownloadTask } from './download-task';

jest.mock('node:fs', () => {
    const actual = jest.requireActual('node:fs');
    return { ...actual, unlinkSync: jest.fn(actual.unlinkSync) };
});
const mockProofs = new Map<number, ArchiveDownloadProof>();
function mockRememberCapture(
    _db: unknown,
    id: number,
    proof: ArchiveDownloadProof,
    path: string,
    kind = 'partial'
) {
    mockProofs.set(id, {
        ...proof,
        [kind === 'partial' ? 'partialCleanupPath' : 'finalCleanupPath']: path,
    });
}
jest.mock('./download-catchup-journal', () => ({
    ...jest.requireActual('./download-catchup-journal'),
    recordArchiveReservation: jest.fn(
        async (_db, id, filePath, partialIdentity) => {
            mockProofs.set(id, {
                version: 1,
                phase: 'transfer',
                filePath,
                partialIdentity,
            });
        }
    ),
    recordArchiveFinalization: jest.fn(async (_db, id, proof) => {
        mockProofs.set(id, proof);
    }),
    recordArchiveCleanupPath: jest.fn(mockRememberCapture),
    clearArchiveFinalization: jest.fn(async (_db, id) => {
        mockProofs.delete(id);
    }),
    readArchiveFinalizations: jest.fn(async () => new Map(mockProofs)),
}));
jest.mock('../../database/connection', () => ({ getDatabase: jest.fn() }));
jest.mock('./download-catchup-transfer', () => ({
    transferCatchupToPartialFile: jest.fn(),
}));
jest.mock('./download-broadcast', () => ({
    broadcastDownloadUpdate: jest.fn(),
}));
beforeEach(() => {
    mockProofs.clear();
    jest.mocked(unlinkSync)
        .mockReset()
        .mockImplementation(jest.requireActual('node:fs').unlinkSync);
    jest.mocked(transferCatchupToPartialFile).mockReset();
    jest.mocked(readArchiveFinalizations)
        .mockReset()
        .mockImplementation(async () => new Map(mockProofs));
    jest.mocked(recordArchiveCleanupPath)
        .mockReset()
        .mockImplementation(mockRememberCapture);
});

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
                        birthtimeMs: active.catchupPartialIdentity.birthtimeMs,
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
                    filePath: null,
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
        const lateCommands: Array<boolean | Promise<boolean>> = [];
        jest.mocked(recordArchiveCleanupPath).mockImplementationOnce(
            (database, id, proof, path, kind) => {
                mockRememberCapture(database, id, proof, path, kind);
                lateCommands.push(pauseDownload(task.id));
                lateCommands.push(cancelDownload(task.id));
                lateCommands.push(removeDownloadFromRuntime(task.id));
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
            expect(await Promise.all(lateCommands)).toEqual([
                false,
                false,
                false,
            ]);
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

it.each(['failed', 'canceled'])(
    'keeps active %s cleanup captures durable until retry',
    async (status) => {
        const directory = await mkdtemp(
            join(tmpdir(), 'active-archive-cleanup-')
        );
        const task: DownloadTask = {
            id: 996,
            directory,
            fileName: 'show.ts',
            url: 'https://provider.test/archive.ts',
            catchup: {
                channelName: 'News',
                startTimestamp: 100,
                stopTimestamp: 200,
            },
        };
        let ready!: () => void, release!: () => void, finish!: () => void;
        const started = new Promise<void>((resolve) => {
            ready = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const settled = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const updates: Record<string, unknown>[] = [];
        const db = {
            update: () => ({
                set: (value: Record<string, unknown>) => ({
                    where: async () => {
                        updates.push(value);
                        if (value.status === status) finish();
                    },
                }),
            }),
        };
        jest.mocked(getDatabase).mockResolvedValue(db as never);
        jest.mocked(transferCatchupToPartialFile).mockImplementationOnce(
            async (_db, active, reservation) => {
                await writeFile(
                    reservation.partialPath,
                    'verified archive bytes'
                );
                active.catchupPartialIdentity = await lstat(
                    reservation.partialPath
                );
                mockProofs.set(active.id, {
                    version: 1,
                    phase: 'transfer',
                    filePath: reservation.path,
                    partialIdentity: active.catchupPartialIdentity,
                });
                ready();
                await gate;
                throw new Error('interrupted transfer');
            }
        );
        jest.mocked(unlinkSync).mockImplementationOnce(() => {
            throw Object.assign(new Error('locked'), { code: 'EACCES' });
        });
        try {
            enqueueDownload(task);
            await started;
            let removal: Promise<boolean> | undefined;
            if (status === 'canceled') {
                removal = prepareArchiveRemoval(task.id);
                let returned = false;
                void removal.then(() => {
                    returned = true;
                });
                await new Promise((resolve) => setImmediate(resolve));
                expect(returned).toBe(false);
                expect(hasRuntimeDownload(task.id)).toBe(true);
            }
            release();
            await settled;
            if (removal) await expect(removal).resolves.toBe(true);
            await new Promise((resolve) => setImmediate(resolve));
            const pointer = mockProofs.get(task.id)?.partialCleanupPath;
            expect(pointer).toBeDefined();
            expect(await readFile(pointer!, 'utf8')).toBe(
                'verified archive bytes'
            );
            expect(updates.at(-1)).toEqual(
                expect.objectContaining({ status, filePath: task.filePath })
            );
            await expect(
                cleanupStoredCatchupPartial(db as never, task.id, task.filePath)
            ).resolves.toBe(true);
            await expect(lstat(pointer!)).rejects.toMatchObject({
                code: 'ENOENT',
            });
        } finally {
            release();
            await rm(directory, { recursive: true, force: true });
        }
    }
);
