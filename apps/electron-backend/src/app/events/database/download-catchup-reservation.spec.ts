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
import { reserveFreshCatchupTarget } from './download-catchup-reservation';
import { clearArchiveFinalization } from './download-catchup-journal';
import type { DownloadsDatabase, DownloadTask } from './download-task';

jest.mock('./download-catchup-journal', () => ({
    clearArchiveFinalization: jest.fn().mockResolvedValue(undefined),
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
