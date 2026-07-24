import { PassThrough, Readable } from 'node:stream';
import {
    requestDownloadCancellation,
    requestDownloadPause,
} from './download-task';
import {
    createTask,
    waitForCallCount,
    waitForStatus,
    waitForStatusCount,
} from './download.test-helpers';

describe('download task interruption', () => {
    it('aborts an active task when cancellation is requested', () => {
        const abort = jest.fn();
        const task = {
            ...createTask(),
            abortController: { abort } as unknown as AbortController,
        };

        requestDownloadCancellation(task);

        expect(task.cancelRequested).toBe(true);
        expect(abort).toHaveBeenCalledTimes(1);
    });

    it('aborts an active task when pause is requested', () => {
        const abort = jest.fn();
        const task = {
            ...createTask(),
            abortController: { abort } as unknown as AbortController,
        };

        requestDownloadPause(task);

        expect(task.pauseRequested).toBe(true);
        expect(abort).toHaveBeenCalledTimes(1);
    });
});

describe('download runtime pause and resume', () => {
    it('persists active pause without deleting the partial file', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const removePartialDownloadFile = jest.fn();
        const stream = new PassThrough();
        const requestWithValidatedRedirects = jest.fn(
            async (
                _url: string,
                options: { signal?: AbortSignal }
            ) => {
                options.signal?.addEventListener('abort', () => {
                    stream.destroy(new Error('aborted'));
                });
                return {
                    data: stream,
                    headers: { 'content-length': '100' },
                    status: 200,
                };
            }
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
            existsSync: jest.fn(() => false),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest
                .fn()
                .mockReturnValueOnce(0)
                .mockReturnValue(25),
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

            await expect(runtime.pauseDownload(42)).resolves.toBe(true);
            await waitForStatus(set, 'paused');

            expect(removePartialDownloadFile).not.toHaveBeenCalled();
            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 25,
                    status: 'paused',
                })
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('uses an HTTP Range header when a partial file already exists', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn(
            async () =>
                ({
                    data: Readable.from([Buffer.from('rest')]),
                    headers: { 'content-range': 'bytes 50-53/54' },
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
            existsSync: jest.fn(() => false),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile: jest.fn(async () => undefined),
            link: jest.fn(async () => undefined),
            stat: jest.fn(async () => ({ size: 54 })),
            unlink: jest.fn(async () => undefined),
        }));
        jest.doMock('./download-file-path', () => ({
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
        });
        await waitForCallCount(requestWithValidatedRedirects, 1);

        expect(requestWithValidatedRedirects).toHaveBeenCalledWith(
            'https://example.test/movie.mp4',
            expect.objectContaining({
                headers: expect.objectContaining({ Range: 'bytes=50-' }),
            }),
            { allowPrivateNetworks: true }
        );
        await waitForStatus(set, 'completed');
    });

    it('deletes a queued resumed partial file when the queued task is canceled', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const removePartialDownloadFile = jest.fn();
        const activeStream = new PassThrough();
        const requestWithValidatedRedirects = jest.fn(
            async (_url: string, options: { signal?: AbortSignal }) => {
                options.signal?.addEventListener('abort', () => {
                    activeStream.destroy(new Error('aborted'));
                });
                return {
                    data: activeStream,
                    headers: { 'content-length': '100' },
                    status: 200,
                };
            }
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

            runtime.enqueueDownload({
                ...createTask(),
                fileName: 'resume.mp4',
                filePath: '/downloads/resume.mp4',
                id: 43,
            });

            await expect(runtime.cancelDownload(43)).resolves.toBe(true);

            expect(removePartialDownloadFile).toHaveBeenCalledWith(
                '/downloads/resume.mp4'
            );
            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 0,
                    filePath: null,
                    status: 'canceled',
                    totalBytes: null,
                })
            );

            await runtime.cancelDownload(42);
            await waitForStatusCount(set, 'canceled', 2);
        } finally {
            consoleError.mockRestore();
        }
    });

    it('retains the partial path when canceling a queued task whose partial cannot be deleted', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = { update: jest.fn(() => ({ set })) };
        const removePartialDownloadFile = jest.fn(() => {
            throw new Error('EPERM: locked');
        });

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

        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            const runtime = await import('./download-runtime');
            runtime.setMainWindow({
                isDestroyed: () => false,
                webContents: { send: jest.fn() },
            } as never);

            // Occupy the active slot so the second task stays queued.
            runtime.enqueueDownload(createTask());
            runtime.enqueueDownload({
                ...createTask(),
                fileName: 'resume.mp4',
                filePath: '/downloads/resume.mp4',
                id: 43,
            });

            await expect(runtime.cancelDownload(43)).resolves.toBe(true);

            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: '/downloads/resume.mp4',
                    status: 'canceled',
                })
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('retains the partial path when canceling a paused row whose partial cannot be deleted', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({
                        limit: jest.fn().mockResolvedValue([
                            {
                                filePath: '/downloads/paused.mp4',
                                status: 'paused',
                            },
                        ]),
                    })),
                })),
            })),
            update: jest.fn(() => ({ set })),
        };
        const removePartialDownloadFile = jest.fn(() => {
            throw new Error('EPERM: locked');
        });

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 0),
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

            await expect(runtime.cancelDownload(77)).resolves.toBe(true);

            expect(removePartialDownloadFile).toHaveBeenCalledWith(
                '/downloads/paused.mp4'
            );
            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: '/downloads/paused.mp4',
                    status: 'canceled',
                })
            );
        } finally {
            consoleError.mockRestore();
        }
    });
});
