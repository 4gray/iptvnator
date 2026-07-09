import { PassThrough, Readable } from 'node:stream';
import {
    requestDownloadCancellation,
    requestDownloadPause,
    type DownloadTask,
} from './download-task';

function createTask(): DownloadTask {
    return {
        directory: '/downloads',
        fileName: 'movie.mp4',
        id: 42,
        url: 'https://example.test/movie.mp4',
    };
}

async function waitForCallCount(
    mock: jest.Mock,
    expectedCallCount: number
): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        if (mock.mock.calls.length === expectedCallCount) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(mock).toHaveBeenCalledTimes(expectedCallCount);
}

async function waitForStatus(
    set: jest.Mock,
    status: string
): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        if (set.mock.calls.some(([value]) => value?.status === status)) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status }));
}

async function waitForStatusCount(
    set: jest.Mock,
    status: string,
    expectedCount: number
): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        const statusCount = set.mock.calls.filter(
            ([value]) => value?.status === status
        ).length;
        if (statusCount >= expectedCount) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(
        set.mock.calls.filter(([value]) => value?.status === status)
    ).toHaveLength(expectedCount);
}

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
});
