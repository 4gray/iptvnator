import { PassThrough, Readable } from 'node:stream';
import type { DownloadTask } from './download-task';

interface ResumeHarness {
    createWriteStream: jest.Mock;
    removePartialDownloadFile: jest.Mock;
    requestWithValidatedRedirects: jest.Mock;
    set: jest.Mock;
    runtime: typeof import('./download-runtime');
}

interface ResumeHarnessOptions {
    partialSize: number;
    response: {
        data: Readable;
        headers: Record<string, string>;
        status: number;
    };
    /** 'enoent' makes stat() report a missing target file. */
    finalSize: number | 'enoent';
}

function createTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
    return {
        directory: '/downloads',
        fileName: 'movie.mp4',
        id: 42,
        url: 'https://example.test/movie.mp4',
        ...overrides,
    };
}

async function waitForStatus(set: jest.Mock, status: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        if (set.mock.calls.some(([value]) => value?.status === status)) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status }));
}

async function setupResumeHarness(
    options: ResumeHarnessOptions
): Promise<ResumeHarness> {
    jest.resetModules();

    const set = jest.fn(() => ({
        where: jest.fn().mockResolvedValue(undefined),
    }));
    const db = { update: jest.fn(() => ({ set })) };
    const requestWithValidatedRedirects = jest.fn(
        async () => options.response as never
    );
    const createWriteStream = jest.fn(() => new PassThrough());
    const removePartialDownloadFile = jest.fn();

    jest.doMock('../../database/connection', () => ({
        getDatabase: jest.fn().mockResolvedValue(db),
    }));
    jest.doMock('../../util/validated-axios', () => ({
        requestWithValidatedRedirects,
    }));
    jest.doMock('node:fs', () => ({
        ...jest.requireActual('node:fs'),
        createWriteStream,
        existsSync: jest.fn(() => false),
    }));
    jest.doMock('node:fs/promises', () => ({
        copyFile: jest.fn(async () => undefined),
        link: jest.fn(async () => undefined),
        stat: jest.fn(async () => {
            if (options.finalSize === 'enoent') {
                const error = new Error('missing') as NodeJS.ErrnoException;
                error.code = 'ENOENT';
                throw error;
            }
            return { size: options.finalSize };
        }),
        unlink: jest.fn(async () => undefined),
    }));
    jest.doMock('./download-file-path', () => ({
        getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
        getPartialDownloadSize: jest.fn(() => options.partialSize),
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

    return {
        createWriteStream,
        removePartialDownloadFile,
        requestWithValidatedRedirects,
        set,
        runtime,
    };
}

describe('download resume validation', () => {
    it('sends the stored validator as If-Range alongside the Range header', async () => {
        const harness = await setupResumeHarness({
            finalSize: 54,
            partialSize: 50,
            response: {
                data: Readable.from([Buffer.from('rest')]),
                headers: { 'content-range': 'bytes 50-53/54' },
                status: 206,
            },
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                resumeValidator: '"etag-1"',
                totalBytes: 54,
            })
        );
        await waitForStatus(harness.set, 'completed');

        expect(harness.requestWithValidatedRedirects).toHaveBeenCalledWith(
            'https://example.test/movie.mp4',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'If-Range': '"etag-1"',
                    Range: 'bytes=50-',
                }),
            }),
            { allowPrivateNetworks: true }
        );
        expect(harness.createWriteStream).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            { flags: 'a' }
        );
    });

    it('restarts from byte zero when a resume request is answered with 200', async () => {
        const harness = await setupResumeHarness({
            finalSize: 4,
            partialSize: 50,
            response: {
                data: Readable.from([Buffer.from('full')]),
                headers: { 'content-length': '4', etag: '"etag-2"' },
                status: 200,
            },
        });
        const consoleWarn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({
                    filePath: '/downloads/movie.mp4',
                    resumeValidator: '"etag-1"',
                    totalBytes: 54,
                })
            );
            await waitForStatus(harness.set, 'completed');

            expect(harness.createWriteStream).toHaveBeenCalledWith(
                '/downloads/movie.mp4.part',
                { flags: 'w' }
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 0,
                    resumeValidator: '"etag-2"',
                    totalBytes: 4,
                })
            );
            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'failed' })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleWarn.mockRestore();
        }
    });

    it('fails the transfer when the 206 response starts at the wrong offset', async () => {
        const body = new PassThrough();
        body.write('rest');
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 50,
            response: {
                data: body,
                headers: { 'content-range': 'bytes 0-53/54' },
                status: 206,
            },
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({
                    filePath: '/downloads/movie.mp4',
                    totalBytes: 54,
                })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorMessage: 'Server returned an invalid resume range',
                    status: 'failed',
                })
            );
            expect(body.destroyed).toBe(true);
        } finally {
            consoleError.mockRestore();
        }
    });

    it('retains the partial when a 206 ends before the advertised size', async () => {
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 50,
            response: {
                // Only 20 of the 50 remaining bytes arrive before EOF.
                data: Readable.from([Buffer.alloc(20, 'r')]),
                headers: { 'content-range': 'bytes 50-99/100' },
                status: 206,
            },
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({
                    filePath: '/downloads/movie.mp4',
                    totalBytes: 100,
                })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 70,
                    errorMessage: 'Transfer ended before the advertised size',
                    filePath: '/downloads/movie.mp4',
                    status: 'failed',
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('captures a strong ETag from the first response for later resumes', async () => {
        const harness = await setupResumeHarness({
            finalSize: 4,
            partialSize: 0,
            response: {
                data: Readable.from([Buffer.from('full')]),
                headers: { 'content-length': '4', etag: '"etag-3"' },
                status: 200,
            },
        });

        harness.runtime.enqueueDownload(createTask());
        await waitForStatus(harness.set, 'completed');

        expect(harness.set).toHaveBeenCalledWith(
            expect.objectContaining({ resumeValidator: '"etag-3"' })
        );
    });

    it('pauses before reservation without a network request or file path', async () => {
        const harness = await setupResumeHarness({
            finalSize: 4,
            partialSize: 0,
            response: {
                data: Readable.from([Buffer.from('full')]),
                headers: { 'content-length': '4' },
                status: 200,
            },
        });

        harness.runtime.enqueueDownload({
            ...createTask(),
            pauseRequested: true,
        });
        await waitForStatus(harness.set, 'paused');

        expect(harness.requestWithValidatedRedirects).not.toHaveBeenCalled();
        expect(harness.set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 0,
                filePath: null,
                status: 'paused',
            })
        );
    });

    it('falls back to Last-Modified when the ETag is weak', async () => {
        const harness = await setupResumeHarness({
            finalSize: 4,
            partialSize: 0,
            response: {
                data: Readable.from([Buffer.from('full')]),
                headers: {
                    'content-length': '4',
                    etag: 'W/"weak-etag"',
                    'last-modified': 'Wed, 01 Jul 2026 10:00:00 GMT',
                },
                status: 200,
            },
        });

        harness.runtime.enqueueDownload(createTask());
        await waitForStatus(harness.set, 'completed');

        expect(harness.set).toHaveBeenCalledWith(
            expect.objectContaining({
                resumeValidator: 'Wed, 01 Jul 2026 10:00:00 GMT',
            })
        );
    });
});
