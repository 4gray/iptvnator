import type { DownloadItem } from 'electron';
import {
    attachDownloadItem,
    requestDownloadCancellation,
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

describe('download runtime cancellation', () => {
    it('cancels the item when an earlier cancellation request reaches onStarted', () => {
        const task = createTask();
        const cancel = jest.fn();

        requestDownloadCancellation(task);
        attachDownloadItem(task, { cancel } as unknown as DownloadItem);

        expect(task.cancelRequested).toBe(true);
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('cancels an already-started item immediately', () => {
        const cancel = jest.fn();
        const task = {
            ...createTask(),
            downloadItem: { cancel } as unknown as DownloadItem,
        };

        requestDownloadCancellation(task);

        expect(task.cancelRequested).toBe(true);
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('continues the queue when cancellation persistence fails', async () => {
        jest.resetModules();

        class TestCancelError extends Error {}

        let cancellationCallback: Promise<void> | undefined;
        const download = jest
            .fn()
            .mockImplementationOnce(
                async (
                    _window: unknown,
                    _url: string,
                    options: {
                        onCancel: (item: DownloadItem) => Promise<void>;
                    }
                ) => {
                    cancellationCallback = options.onCancel({
                        getSavePath: () => '/downloads/movie.mp4',
                    } as unknown as DownloadItem);
                    throw new TestCancelError();
                }
            )
            .mockImplementationOnce(
                async (
                    _window: unknown,
                    _url: string,
                    options: {
                        onCompleted: (file: {
                            fileSize: number;
                            filename: string;
                            path: string;
                        }) => Promise<void>;
                    }
                ) => {
                    await options.onCompleted({
                        fileSize: 1,
                        filename: 'second.mp4',
                        path: '/downloads/second.mp4',
                    });
                }
            );

        const where = jest
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('database is busy'))
            .mockResolvedValue(undefined);
        const db = {
            update: jest.fn(() => ({
                set: jest.fn(() => ({ where })),
            })),
        };

        jest.doMock('electron-dl', () => ({
            CancelError: TestCancelError,
            download,
        }));
        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            removePartialDownload: jest.fn(),
            reserveAvailableDownloadFile: jest.fn(
                (directory: string, filename: string) => ({
                    filename,
                    path: `${directory}/${filename}`,
                })
            ),
        }));

        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const runtime = await import('./download-runtime');
        runtime.setMainWindow({
            isDestroyed: () => false,
            webContents: { send: jest.fn() },
        } as never);

        runtime.enqueueDownload(createTask());
        runtime.enqueueDownload({
            ...createTask(),
            fileName: 'second.mp4',
            id: 43,
        });

        await waitForCallCount(download, 2);
        await expect(cancellationCallback).resolves.toBeUndefined();

        consoleError.mockRestore();
    });

    it('continues the queue when completion persistence fails', async () => {
        jest.resetModules();

        class TestCancelError extends Error {}

        let completionCallback: Promise<void> | undefined;
        const download = jest
            .fn()
            .mockImplementationOnce(
                async (
                    _window: unknown,
                    _url: string,
                    options: {
                        onCompleted: (file: {
                            fileSize: number;
                            filename: string;
                            path: string;
                        }) => Promise<void>;
                    }
                ) => {
                    completionCallback = options.onCompleted({
                        fileSize: 1,
                        filename: 'movie.mp4',
                        path: '/downloads/movie.mp4',
                    });
                }
            )
            .mockImplementationOnce(
                async (
                    _window: unknown,
                    _url: string,
                    options: {
                        onCompleted: (file: {
                            fileSize: number;
                            filename: string;
                            path: string;
                        }) => Promise<void>;
                    }
                ) => {
                    await options.onCompleted({
                        fileSize: 1,
                        filename: 'second.mp4',
                        path: '/downloads/second.mp4',
                    });
                }
            );

        const where = jest
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('database is busy'))
            .mockResolvedValue(undefined);
        const db = {
            update: jest.fn(() => ({
                set: jest.fn(() => ({ where })),
            })),
        };

        jest.doMock('electron-dl', () => ({
            CancelError: TestCancelError,
            download,
        }));
        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            removePartialDownload: jest.fn(),
            reserveAvailableDownloadFile: jest.fn(
                (directory: string, filename: string) => ({
                    filename,
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
            runtime.enqueueDownload({
                ...createTask(),
                fileName: 'second.mp4',
                id: 43,
            });

            await waitForCallCount(download, 2);
            await expect(completionCallback).resolves.toBeUndefined();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('continues the queue when initial database access fails', async () => {
        jest.resetModules();

        class TestCancelError extends Error {}

        const download = jest.fn(
            async (
                _window: unknown,
                _url: string,
                options: {
                    onCompleted: (file: {
                        fileSize: number;
                        filename: string;
                        path: string;
                    }) => Promise<void>;
                }
            ) => {
                await options.onCompleted({
                    fileSize: 1,
                    filename: 'second.mp4',
                    path: '/downloads/second.mp4',
                });
            }
        );
        const where = jest.fn().mockResolvedValue(undefined);
        const db = {
            update: jest.fn(() => ({
                set: jest.fn(() => ({ where })),
            })),
        };
        const getDatabase = jest
            .fn()
            .mockRejectedValueOnce(new Error('database unavailable'))
            .mockResolvedValue(db);

        jest.doMock('electron-dl', () => ({
            CancelError: TestCancelError,
            download,
        }));
        jest.doMock('../../database/connection', () => ({ getDatabase }));
        jest.doMock('./download-file-path', () => ({
            removePartialDownload: jest.fn(),
            reserveAvailableDownloadFile: jest.fn(
                (directory: string, filename: string) => ({
                    filename,
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
            runtime.enqueueDownload({
                ...createTask(),
                fileName: 'second.mp4',
                id: 43,
            });

            await waitForCallCount(download, 1);
            expect(download).toHaveBeenCalledWith(
                expect.anything(),
                'https://example.test/movie.mp4',
                expect.objectContaining({ filename: 'second.mp4' })
            );
        } finally {
            consoleError.mockRestore();
        }
    });
});
