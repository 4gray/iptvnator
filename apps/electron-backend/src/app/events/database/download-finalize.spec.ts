import { PassThrough, Readable } from 'node:stream';
import {
    createTask,
    waitForCallCount,
    waitForStatus,
} from './download-spec-helpers';

describe('download finalization', () => {
    it('falls back to copying the completed partial when hard links are unsupported', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn(
            async () =>
                ({
                    data: Readable.from([Buffer.from('full')]),
                    headers: { 'content-length': '4' },
                    status: 200,
                }) as never
        );
        const link = jest.fn(async () => {
            const error = new Error('not supported') as NodeJS.ErrnoException;
            error.code = 'EXDEV';
            throw error;
        });
        const copyFile = jest.fn(async () => undefined);
        const unlink = jest.fn(async () => undefined);

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../../util/validated-axios', () => ({
            requestWithValidatedRedirects,
        }));
        jest.doMock('node:fs', () => ({
            ...jest.requireActual('node:fs'),
            createWriteStream: jest.fn(() => new PassThrough()),
            existsSync: jest.fn(() => false),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile,
            link,
            stat: jest.fn(async () => ({ size: 4 })),
            unlink,
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 0),
            removePartialDownloadFile: jest.fn(),
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

        runtime.enqueueDownload(createTask());
        await waitForCallCount(requestWithValidatedRedirects, 1);
        await waitForStatus(set, 'completed');

        expect(link).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            '/downloads/movie.mp4'
        );
        expect(copyFile).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            '/downloads/movie.mp4',
            expect.any(Number)
        );
        expect(unlink).toHaveBeenCalledWith('/downloads/movie.mp4.part');
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 4,
                filePath: '/downloads/movie.mp4',
                status: 'completed',
            })
        );
    });

    it('completes when copied output exists but partial cleanup fails', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn(
            async () =>
                ({
                    data: Readable.from([Buffer.from('full')]),
                    headers: { 'content-length': '4' },
                    status: 200,
                }) as never
        );
        const link = jest.fn(async () => {
            const error = new Error('not supported') as NodeJS.ErrnoException;
            error.code = 'EXDEV';
            throw error;
        });
        const copyFile = jest.fn(async () => undefined);
        const unlink = jest.fn(async () => {
            const error = new Error('cleanup denied') as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
        });

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../../util/validated-axios', () => ({
            requestWithValidatedRedirects,
        }));
        jest.doMock('node:fs', () => ({
            ...jest.requireActual('node:fs'),
            createWriteStream: jest.fn(() => new PassThrough()),
            existsSync: jest.fn(() => false),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile,
            link,
            stat: jest.fn(async () => ({ size: 4 })),
            unlink,
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 0),
            removePartialDownloadFile: jest.fn(),
            reserveAvailablePartialDownloadFile: jest.fn(
                (directory: string, filename: string) => ({
                    filename,
                    partialPath: `${directory}/${filename}.part`,
                    path: `${directory}/${filename}`,
                })
            ),
        }));

        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            const runtime = await import('./download-runtime');
            runtime.setMainWindow({
                isDestroyed: () => false,
                webContents: { send: jest.fn() },
            } as never);

            runtime.enqueueDownload(createTask());
            await waitForCallCount(requestWithValidatedRedirects, 1);
            await waitForStatus(set, 'completed');

            expect(copyFile).toHaveBeenCalledWith(
                '/downloads/movie.mp4.part',
                '/downloads/movie.mp4',
                expect.any(Number)
            );
            expect(unlink).toHaveBeenCalledWith('/downloads/movie.mp4.part');
            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 4,
                    errorMessage: null,
                    fileName: 'movie.mp4',
                    filePath: '/downloads/movie.mp4',
                    status: 'completed',
                    totalBytes: 4,
                })
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('preserves a completed partial when finalization fails', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn(
            async () =>
                ({
                    data: Readable.from([Buffer.from('full')]),
                    headers: { 'content-length': '4' },
                    status: 200,
                }) as never
        );
        const link = jest.fn(async () => {
            const error = new Error('not supported') as NodeJS.ErrnoException;
            error.code = 'EXDEV';
            throw error;
        });
        const copyFile = jest.fn(async () => {
            const error = new Error('disk full') as NodeJS.ErrnoException;
            error.code = 'ENOSPC';
            throw error;
        });
        const unlink = jest.fn(async () => undefined);
        const removePartialDownloadFile = jest.fn();

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../../util/validated-axios', () => ({
            requestWithValidatedRedirects,
        }));
        jest.doMock('node:fs', () => ({
            ...jest.requireActual('node:fs'),
            createWriteStream: jest.fn(() => new PassThrough()),
            existsSync: jest.fn(() => false),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile,
            link,
            stat: jest.fn(async () => ({ size: 4 })),
            unlink,
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

        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            const runtime = await import('./download-runtime');
            runtime.setMainWindow({
                isDestroyed: () => false,
                webContents: { send: jest.fn() },
            } as never);

            runtime.enqueueDownload(createTask());
            await waitForCallCount(requestWithValidatedRedirects, 1);
            await waitForStatus(set, 'failed');

            expect(copyFile).toHaveBeenCalledWith(
                '/downloads/movie.mp4.part',
                '/downloads/movie.mp4',
                expect.any(Number)
            );
            expect(unlink).not.toHaveBeenCalled();
            expect(removePartialDownloadFile).not.toHaveBeenCalled();
            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 4,
                    errorMessage: 'disk full',
                    fileName: 'movie.mp4',
                    filePath: '/downloads/movie.mp4',
                    status: 'failed',
                    totalBytes: 4,
                })
            );
        } finally {
            consoleError.mockRestore();
        }
    });
});
