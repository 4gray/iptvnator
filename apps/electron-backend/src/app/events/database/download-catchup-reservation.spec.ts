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
    readArchiveFinalizations,
} from './download-catchup-journal';
import type { DownloadsDatabase, DownloadTask } from './download-task';

jest.mock('./download-catchup-journal', () => ({
    ...jest.requireActual('./download-catchup-journal'),
    clearArchiveFinalization: jest.fn().mockResolvedValue(undefined),
    readArchiveFinalizations: jest.fn(),
    recordArchiveCleanupPath: jest.fn(),
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
                expect(task.catchupExpectedPartialIdentity).toBeUndefined();
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
