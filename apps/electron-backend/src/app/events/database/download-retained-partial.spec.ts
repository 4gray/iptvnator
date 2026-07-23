import { PassThrough } from 'node:stream';
import { createTask, waitForStatus } from './download.test-helpers';

describe('retained completed partials', () => {
    it('finalizes a retained completed partial without another HTTP request', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn();
        const link = jest.fn(async () => undefined);
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
            existsSync: jest.fn((filePath: string) =>
                filePath.endsWith('.part')
            ),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile: jest.fn(async () => undefined),
            link,
            stat: jest.fn(async () => ({ size: 4 })),
            unlink,
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 4),
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
            totalBytes: 4,
        });
        await waitForStatus(set, 'completed');

        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
        expect(link).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            '/downloads/movie.mp4'
        );
        expect(unlink).toHaveBeenCalledWith('/downloads/movie.mp4.part');
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 4,
                filePath: '/downloads/movie.mp4',
                status: 'completed',
                totalBytes: 4,
            })
        );
    });

    it('replaces an incomplete target before finalizing a retained completed partial', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn();
        const link = jest.fn(async () => undefined);
        const stat = jest
            .fn()
            .mockResolvedValueOnce({ size: 2 })
            .mockResolvedValue({ size: 4 });
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
            existsSync: jest.fn(() => true),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile: jest.fn(async () => undefined),
            link,
            stat,
            unlink,
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 4),
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
            totalBytes: 4,
        });
        await waitForStatus(set, 'completed');

        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
        expect(unlink).toHaveBeenNthCalledWith(1, '/downloads/movie.mp4');
        expect(link).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            '/downloads/movie.mp4'
        );
        expect(unlink).toHaveBeenNthCalledWith(2, '/downloads/movie.mp4.part');
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 4,
                filePath: '/downloads/movie.mp4',
                status: 'completed',
                totalBytes: 4,
            })
        );
    });

    it('completes a retained finished download when retry is blocked by an existing destination', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn();
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
            existsSync: jest.fn(() => true),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile: jest.fn(async () => undefined),
            link: jest.fn(async () => undefined),
            stat: jest.fn(async () => ({ size: 4 })),
            unlink: jest.fn(async () => undefined),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 4),
            removePartialDownloadFile,
            reserveAvailablePartialDownloadFile: jest.fn(),
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

            runtime.enqueueDownload({
                ...createTask(),
                filePath: '/downloads/movie.mp4',
                totalBytes: 4,
            });
            await waitForStatus(set, 'completed');

            expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
            expect(removePartialDownloadFile).toHaveBeenCalledWith(
                '/downloads/movie.mp4'
            );
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
});
