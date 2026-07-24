import { PassThrough, Readable } from 'node:stream';
import { createTask, waitForStatus } from './download.test-helpers';

describe('destination collision handling', () => {
    it('redirects a retained partial to a numbered destination instead of unlinking', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({
            where: jest.fn().mockResolvedValue(undefined),
        }));
        const db = { update: jest.fn(() => ({ set })) };
        const occupied = new Set([
            '/downloads/movie.mp4',
            '/downloads/movie.mp4.part',
        ]);
        const renameMock = jest.fn(async () => undefined);
        const unlinkMock = jest.fn(async () => undefined);
        const requestWithValidatedRedirects = jest.fn(
            async () =>
                ({
                    data: Readable.from([Buffer.alloc(50, 'r')]),
                    headers: { 'content-range': 'bytes 50-99/100' },
                    status: 206,
                }) as never
        );

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../../util/validated-axios', () => ({
            requestWithValidatedRedirects,
        }));
        jest.doMock('node:fs', () => ({
            ...jest.requireActual('node:fs'),
            createWriteStream: jest.fn(() => new PassThrough()),
            existsSync: jest.fn((path: string) => occupied.has(path)),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile: jest.fn(async () => undefined),
            link: jest.fn(async () => undefined),
            rename: renameMock,
            stat: jest.fn(async () => ({ size: 100 })),
            unlink: unlinkMock,
        }));
        jest.doMock('./download-file-path', () => ({
            findAvailableFinalPath: jest.fn(() => ({
                filename: 'movie (1).mp4',
                path: '/downloads/movie (1).mp4',
            })),
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 50),
            removePartialDownloadFile: jest.fn(),
            reserveAvailablePartialDownloadFile: jest.fn(),
        }));

        const runtime = await import('./download-runtime');
        runtime.setMainWindow({
            isDestroyed: () => false,
            webContents: { send: jest.fn() },
        } as never);

        runtime.enqueueDownload({
            ...createTask(),
            filePath: '/downloads/movie.mp4',
            totalBytes: 100,
        });
        await waitForStatus(set, 'completed');

        // The foreign file at the recorded destination is never touched.
        expect(unlinkMock).not.toHaveBeenCalledWith('/downloads/movie.mp4');
        expect(renameMock).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            '/downloads/movie (1).mp4.part'
        );
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                fileName: 'movie (1).mp4',
                filePath: '/downloads/movie (1).mp4',
            })
        );
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                filePath: '/downloads/movie (1).mp4',
                status: 'completed',
            })
        );
    });
});

describe('queue deduplication', () => {
    it('ignores a second enqueue for an id that is already queued', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({
            where: jest.fn().mockResolvedValue(undefined),
        }));
        const db = { update: jest.fn(() => ({ set })) };
        const removePartialDownloadFile = jest.fn();

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../../util/validated-axios', () => ({
            requestWithValidatedRedirects: jest.fn(
                () => new Promise(() => undefined)
            ),
        }));
        jest.doMock('node:fs', () => ({
            ...jest.requireActual('node:fs'),
            createWriteStream: jest.fn(() => new PassThrough()),
            existsSync: jest.fn(() => false),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 0),
            removePartialDownloadFile,
            reserveAvailablePartialDownloadFile: jest.fn(
                (directory: string, filename: string) => ({
                    filename,
                    partialPath: `${directory}/${filename}.part`,
                    path: `${directory}/${filename}`,
                })
            ),
        }));

        const runtime = await import('./download-runtime');
        runtime.setMainWindow({
            isDestroyed: () => false,
            webContents: { send: jest.fn() },
        } as never);

        // Occupy the active slot, then enqueue id 43 twice (double resume).
        runtime.enqueueDownload(createTask());
        runtime.enqueueDownload({ ...createTask(), id: 43 });
        runtime.enqueueDownload({ ...createTask(), id: 43 });

        // Only one queue entry exists: the first cancel finds it, the second
        // finds nothing (and no paused DB row backs id 43 in this harness).
        const dbSelect = jest.fn(() => ({
            from: jest.fn(() => ({
                where: jest.fn(() => ({
                    limit: jest.fn().mockResolvedValue([]),
                })),
            })),
        }));
        (db as { select?: jest.Mock }).select = dbSelect;

        await expect(runtime.cancelDownload(43)).resolves.toBe(true);
        await expect(runtime.cancelDownload(43)).resolves.toBe(false);
    });
});
