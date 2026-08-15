import { PassThrough, Readable } from 'node:stream';
import {
    createTask,
    setupResumeHarness,
    waitForStatus,
} from './download-resume.test-helpers';

jest.setTimeout(20_000);

describe('download resume validation', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        warnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });
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
    it('does not complete a reset at the end of an indeterminate range', async () => {
        // A range-capping server serving `bytes 50-99/*` and resetting at 100
        // proves only that the range was delivered — the entity may be far
        // larger, so this must stay a retained interruption.
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 50,
            partialSizeAfterTransferError: 100,
            responses: [
                {
                    data: body,
                    headers: { 'content-range': 'bytes 50-99/*' },
                    status: 206,
                },
                {
                    data: Readable.from([]),
                    headers: { 'content-range': 'bytes 100-149/*' },
                    status: 206,
                },
            ],
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({
                    filePath: '/downloads/movie.mp4',
                    resumeValidator: '"etag-1"',
                })
            );
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            body.write(Buffer.alloc(50, 'r'));
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 100,
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
    it('completes when the connection resets after the final ranged byte', async () => {
        // Some panels reset instead of closing cleanly once the last byte is
        // sent. With every advertised byte on disk this is a completion — an
        // interruption would resume at EOF, collect a 416, and truncate the
        // complete file.
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 100,
            partialSize: 50,
            partialSizeAfterTransferError: 100,
            response: {
                data: body,
                headers: { 'content-range': 'bytes 50-99/100' },
                status: 206,
            },
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                resumeValidator: '"etag-1"',
                totalBytes: 100,
            })
        );
        while (harness.requestWithValidatedRedirects.mock.calls.length < 1) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }

        body.write(Buffer.alloc(50, 'r'));
        const resetError = new Error('socket hang up') as NodeJS.ErrnoException;
        resetError.code = 'ECONNRESET';
        body.destroy(resetError);
        await waitForStatus(harness.set, 'completed');

        expect(harness.requestWithValidatedRedirects).toHaveBeenCalledTimes(1);
        expect(harness.set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 100,
                status: 'completed',
                totalBytes: 100,
            })
        );
        expect(harness.truncate).not.toHaveBeenCalled();
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
                    resumeValidator: '"etag-1"',
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
    it('retains the partial and reconnects when a 206 ends before the advertised size', async () => {
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
                    resumeValidator: '"etag-1"',
                    totalBytes: 100,
                })
            );
            await waitForStatus(harness.set, 'failed');

            // The truncated attempt's progress is persisted before the
            // stalled reconnects (against the same exhausted mock stream)
            // surface the final retained failure.
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 70,
                    totalBytes: 100,
                })
            );
            expect(
                harness.requestWithValidatedRedirects.mock.calls.length
            ).toBeGreaterThan(1);
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
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
    it('retains received bytes when the connection resets mid-transfer', async () => {
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 0,
            partialSizeAfterTransferError: 20,
            response: {
                data: body,
                headers: {
                    'content-length': '100',
                    etag: '"etag-reset"',
                },
                status: 200,
            },
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(createTask());
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            body.write(Buffer.alloc(20, 'r'));
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 20,
                    errorMessage: expect.stringContaining(
                        'DOWNLOAD_NETWORK_INTERRUPTED'
                    ),
                    filePath: '/downloads/movie.mp4',
                    status: 'failed',
                    totalBytes: 100,
                })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    resumeValidator: '"etag-reset"',
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
    it('retains an existing partial when a resumed response resets before another byte', async () => {
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 40,
            partialSizeAfterTransferError: 40,
            response: {
                data: body,
                headers: { 'content-range': 'bytes 40-99/100' },
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
                    resumeValidator: '"etag-reset"',
                    totalBytes: 100,
                })
            );
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 40,
                    errorMessage: expect.stringContaining(
                        'DOWNLOAD_NETWORK_INTERRUPTED'
                    ),
                    filePath: '/downloads/movie.mp4',
                    status: 'failed',
                    totalBytes: 100,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
    it('keeps the known total when a reconnect answers without one, retaining the partial', async () => {
        const firstBody = new PassThrough();
        const chunkedBody = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 0,
            partialSizeAfterTransferError: 20,
            partialTail: Buffer.alloc(20, 'r'),
            responses: [
                {
                    data: firstBody,
                    headers: { 'content-length': '100' },
                    status: 200,
                },
                {
                    // Chunked reconnect: no usable total in the response.
                    data: chunkedBody,
                    headers: {},
                    status: 200,
                },
            ],
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(createTask());
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            firstBody.write(Buffer.alloc(20, 'r'));
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            firstBody.destroy(resetError);
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 2
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            const secondReset = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            secondReset.code = 'ECONNRESET';
            chunkedBody.destroy(secondReset);
            await waitForStatus(harness.set, 'failed');

            // The total learned from the first response classifies the
            // chunked reconnect's reset as retained — never generic cleanup.
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorMessage: expect.stringContaining(
                        'DOWNLOAD_NETWORK_INTERRUPTED'
                    ),
                    filePath: '/downloads/movie.mp4',
                    status: 'failed',
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
    it.each([
        {
            code: 'EUNKNOWN',
            headers: { 'content-length': '100' },
            label: 'unknown stream error',
            partialSizeAfterTransferError: 20,
        },
        {
            code: 'ECONNRESET',
            headers: { 'content-length': '100' },
            label: 'fresh zero-byte failure',
            partialSizeAfterTransferError: 0,
        },
    ])(
        'uses generic cleanup for $label',
        async ({ code, headers, partialSizeAfterTransferError }) => {
            const body = new PassThrough();
            const harness = await setupResumeHarness({
                finalSize: 'enoent',
                partialSize: 0,
                partialSizeAfterTransferError,
                response: { data: body, headers, status: 200 },
            });
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);

            try {
                harness.runtime.enqueueDownload(createTask());
                while (
                    harness.requestWithValidatedRedirects.mock.calls.length < 1
                ) {
                    await new Promise<void>((resolve) => setImmediate(resolve));
                }

                const streamError = new Error(
                    'socket hang up'
                ) as NodeJS.ErrnoException;
                streamError.code = code;
                body.destroy(streamError);
                await waitForStatus(harness.set, 'failed');

                expect(harness.removePartialDownloadFile).toHaveBeenCalledWith(
                    '/downloads/movie.mp4'
                );
                expect(harness.set).toHaveBeenCalledWith(
                    expect.objectContaining({
                        errorMessage: 'socket hang up',
                        filePath: null,
                        status: 'failed',
                    })
                );
            } finally {
                consoleError.mockRestore();
            }
        }
    );
    it.each([
        {
            headers: {},
            label: 'the response advertised no total',
            partialSizeAfterTransferError: 20,
            partialTail: Buffer.alloc(20, 'r'),
        },
        {
            headers: { 'content-length': '100' },
            label: 'the partial exceeds the advertised total',
            partialSizeAfterTransferError: 101,
            partialTail: Buffer.alloc(101, 'r'),
        },
    ])(
        'retains the partial with an unknown total when $label',
        async ({ headers, partialSizeAfterTransferError, partialTail }) => {
            const body = new PassThrough();
            const harness = await setupResumeHarness({
                finalSize: 'enoent',
                partialSize: 0,
                partialSizeAfterTransferError,
                partialTail,
                response: { data: body, headers, status: 200 },
            });
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);

            try {
                harness.runtime.enqueueDownload(createTask());
                while (
                    harness.requestWithValidatedRedirects.mock.calls.length < 1
                ) {
                    await new Promise<void>((resolve) => setImmediate(resolve));
                }

                const streamError = new Error(
                    'socket hang up'
                ) as NodeJS.ErrnoException;
                streamError.code = 'ECONNRESET';
                body.destroy(streamError);
                await waitForStatus(harness.set, 'failed');

                expect(harness.set).toHaveBeenCalledWith(
                    expect.objectContaining({
                        bytesDownloaded: partialSizeAfterTransferError,
                        errorMessage: expect.stringContaining(
                            'DOWNLOAD_NETWORK_INTERRUPTED'
                        ),
                        filePath: '/downloads/movie.mp4',
                        status: 'failed',
                        totalBytes: null,
                    })
                );
                expect(
                    harness.removePartialDownloadFile
                ).not.toHaveBeenCalled();
            } finally {
                consoleError.mockRestore();
            }
        }
    );
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
