import { archiveFileStats } from './download-catchup-stats';
import { openCatchupOutput } from './download-catchup-output';
import {
    mkdtemp,
    lstat,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveTarget } from './download-runtime-reservation';
import { reserveFreshCatchupTarget } from './download-catchup-reservation';
import {
    clearArchiveFinalization,
    recordArchiveReservation,
    readArchiveFinalizations,
} from './download-catchup-journal';
import type { DownloadsDatabase, DownloadTask } from './download-task';

jest.mock('./download-catchup-journal', () => ({
    ...jest.requireActual('./download-catchup-journal'),
    clearArchiveFinalization: jest.fn().mockResolvedValue(undefined),
    readArchiveFinalizations: jest.fn(),
    recordArchiveCleanupPath: jest.fn(),
    recordArchiveReservation: jest.fn().mockResolvedValue(undefined),
}));

it.each([false, true])(
    'handles an occupied final without relocating a partial (replaced=%s)',
    async (replaced) => {
        const directory = await mkdtemp(join(tmpdir(), 'archive-collision-'));
        const filePath = join(directory, 'show.ts');
        try {
            await writeFile(filePath, 'unrelated final');
            await writeFile(filePath + '.part', 'owned bytes');
            const task: DownloadTask = {
                id: 1,
                filePath,
                directory,
                fileName: 'show.ts',
                url: 'https://provider.test/archive.ts',
                catchupExpectedPartialIdentity: await lstat(filePath + '.part'),
            };
            jest.mocked(readArchiveFinalizations).mockResolvedValue(
                new Map([
                    [
                        1,
                        {
                            version: 1,
                            phase: 'transfer',
                            filePath,
                            partialIdentity:
                                task.catchupExpectedPartialIdentity!,
                        },
                    ],
                ])
            );
            if (replaced) {
                await rename(
                    filePath + '.part',
                    join(directory, 'owned-original')
                );
                await writeFile(filePath + '.part', 'unrelated partial');
            }
            jest.mocked(clearArchiveFinalization).mockClear();
            const reserve = reserveFreshCatchupTarget(
                {} as DownloadsDatabase,
                task
            );
            if (replaced) {
                await expect(reserve).rejects.toThrow('changed');
                expect(await readFile(filePath + '.part', 'utf8')).toBe(
                    'unrelated partial'
                );
                await expect(
                    lstat(join(directory, 'show (1).ts.part'))
                ).rejects.toMatchObject({ code: 'ENOENT' });
                expect(clearArchiveFinalization).not.toHaveBeenCalled();
            } else {
                await expect(reserve).resolves.toEqual({
                    path: join(directory, 'show (1).ts'),
                    partialPath: join(directory, 'show (1).ts.part'),
                    filename: 'show (1).ts',
                });
                await expect(lstat(filePath + '.part')).rejects.toMatchObject({
                    code: 'ENOENT',
                });
                expect(
                    archiveFileStats(
                        await lstat(join(directory, 'show (1).ts.part'))
                    )
                ).toEqual(
                    expect.objectContaining(
                        task.catchupExpectedPartialIdentity!
                    )
                );
            }
            expect(await readFile(filePath, 'utf8')).toBe('unrelated final');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
);

it('removes a journaled incomplete final before retrying the retained archive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'archive-retry-copy-'));
    const filePath = join(directory, 'show.ts');
    try {
        await writeFile(filePath, 'incomplete');
        await writeFile(filePath + '.part', 'complete source');
        const proof = {
            version: 1 as const,
            filePath,
            size: 100,
            partialIdentity: await lstat(filePath + '.part'),
            finalIdentity: await lstat(filePath),
        };
        jest.mocked(readArchiveFinalizations).mockResolvedValue(
            new Map([[1, proof]])
        );
        const task: DownloadTask = {
            id: 1,
            filePath,
            fileName: 'show.ts',
            directory,
            url: 'https://provider.test/archive.ts',
            catchup: {
                channelName: 'News',
                startTimestamp: 100,
                stopTimestamp: 200,
            },
        };
        await expect(
            reserveTarget({} as DownloadsDatabase, task)
        ).resolves.toMatchObject({ path: filePath });
        await expect(lstat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(filePath + '.part', 'utf8')).toBe(
            'complete source'
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it('binds a fresh reservation before a replacement can arrive during the HTTP wait', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'archive-fresh-owner-'));
    const task: DownloadTask = {
        id: 19,
        directory,
        fileName: 'show.ts',
        url: 'https://provider.test/archive.ts',
        catchup: {
            channelName: 'News',
            startTimestamp: 100,
            stopTimestamp: 200,
        },
    };
    try {
        const reservation = await reserveTarget({} as DownloadsDatabase, task);
        expect(recordArchiveReservation).toHaveBeenCalledWith(
            expect.anything(),
            task.id,
            reservation.path,
            task.catchupExpectedPartialIdentity,
            reservation.filename
        );
        await rename(reservation.partialPath, join(directory, 'original'));
        await writeFile(
            reservation.partialPath,
            'foreign file created before the response'
        );
        await expect(
            openCatchupOutput(
                reservation.partialPath,
                task.catchupExpectedPartialIdentity
            )
        ).rejects.toThrow('changed');
        expect(await readFile(reservation.partialPath, 'utf8')).toBe(
            'foreign file created before the response'
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it.each([false, true])(
    'cleans a failed reservation journal without deleting a replacement (replaced=%s)',
    async (replaced) => {
        const directory = await mkdtemp(
            join(tmpdir(), 'archive-reservation-failure-')
        );
        const filePath = join(directory, 'show.ts');
        const task: DownloadTask = {
            id: 20,
            directory,
            fileName: 'show.ts',
            url: 'https://provider.test/archive.ts',
            catchup: {
                channelName: 'News',
                startTimestamp: 100,
                stopTimestamp: 200,
            },
        };
        const failure = new Error('SQLite write failed');
        jest.mocked(recordArchiveReservation)
            .mockImplementationOnce(async () => {
                if (replaced) {
                    await rename(
                        filePath + '.part',
                        join(directory, 'original')
                    );
                    await writeFile(filePath + '.part', 'foreign bytes');
                }
                throw failure;
            })
            .mockImplementationOnce(async (_db, id, path, identity) => {
                jest.mocked(readArchiveFinalizations).mockResolvedValue(
                    new Map([
                        [
                            id,
                            {
                                version: 1,
                                phase: 'transfer',
                                filePath: path,
                                partialIdentity: identity,
                            },
                        ],
                    ])
                );
            });
        try {
            await expect(
                reserveTarget({} as DownloadsDatabase, task)
            ).rejects.toBe(failure);
            if (replaced) {
                expect(await readFile(filePath + '.part', 'utf8')).toBe(
                    'foreign bytes'
                );
            } else {
                await expect(lstat(filePath + '.part')).rejects.toMatchObject({
                    code: 'ENOENT',
                });
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
);

it.each([false, true])(
    'never relocates an unjournaled reservation when SQLite remains unavailable (replaced=%s)',
    async (replaced) => {
        const directory = await mkdtemp(join(tmpdir(), 'archive-no-journal-'));
        const filePath = join(directory, 'show.ts');
        const task: DownloadTask = {
            id: 21,
            directory,
            fileName: 'show.ts',
            url: 'https://provider.test/archive.ts',
            catchup: {
                channelName: 'News',
                startTimestamp: 100,
                stopTimestamp: 200,
            },
        };
        const failure = new Error('SQLite unavailable');
        jest.mocked(recordArchiveReservation)
            .mockImplementationOnce(async () => {
                if (replaced) {
                    await rename(
                        filePath + '.part',
                        join(directory, 'original')
                    );
                    await writeFile(filePath + '.part', 'foreign bytes');
                }
                throw failure;
            })
            .mockRejectedValueOnce(failure);
        try {
            await expect(
                reserveTarget({} as DownloadsDatabase, task)
            ).rejects.toBe(failure);
            expect(await readFile(filePath + '.part', 'utf8')).toBe(
                replaced ? 'foreign bytes' : ''
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
);
