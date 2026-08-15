import { PassThrough, Readable } from 'node:stream';
import type { DownloadTask } from './download-task';

interface ResumeHarness {
    createWriteStream: jest.Mock;
    removePartialDownloadFile: jest.Mock;
    requestWithValidatedRedirects: jest.Mock;
    set: jest.Mock;
    truncate: jest.Mock;
    writtenChunks: Buffer[];
    runtime: typeof import('./download-runtime');
}

type ResumeHarnessResponse =
    | {
          data: Readable;
          headers: Record<string, string>;
          status: number;
      }
    | { requestError: unknown };

interface ResumeHarnessOptions {
    partialSize: number;
    partialSizeAfterTransferError?: number;
    /** Single response reused for every request, or one per request in order. */
    response?: ResumeHarnessResponse;
    responses?: ResumeHarnessResponse[];
    /** Bytes served by the mocked partial-tail read for overlap resumes. */
    partialTail?: Buffer;
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
    // Reconnect attempts interleave zero-delay timers between transfers, so
    // poll on a timer (not setImmediate) with headroom for several attempts.
    for (let attempt = 0; attempt < 200; attempt++) {
        if (set.mock.calls.some(([value]) => value?.status === status)) {
            return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
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
    const responses = options.responses ?? [
        options.response as ResumeHarnessResponse,
    ];
    let requestCount = 0;
    const requestWithValidatedRedirects = jest.fn(async () => {
        const entry = responses[Math.min(requestCount++, responses.length - 1)];
        if (entry && 'requestError' in entry) {
            throw entry.requestError;
        }
        return entry as never;
    });
    const writtenChunks: Buffer[] = [];
    const createWriteStream = jest.fn(() => {
        const sink = new PassThrough();
        sink.on('data', (chunk: Buffer) => writtenChunks.push(chunk));
        return sink;
    });
    const removePartialDownloadFile = jest.fn();
    const truncate = jest.fn(async () => undefined);

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
        open: jest.fn(async () => {
            // The tail buffer stands in for the partial's overlap window; the
            // first read's position anchors it, so the mock works for any
            // rewound offset.
            const tail = options.partialTail ?? Buffer.alloc(0);
            let basePosition: number | null = null;
            return {
                close: jest.fn(async () => undefined),
                read: jest.fn(
                    async (
                        buffer: Buffer,
                        offset: number,
                        length: number,
                        position: number
                    ) => {
                        basePosition ??= position;
                        const start = position - basePosition;
                        const slice = tail.subarray(start, start + length);
                        slice.copy(buffer, offset);
                        return { bytesRead: slice.length };
                    }
                ),
            };
        }),
        stat: jest.fn(async () => {
            if (options.finalSize === 'enoent') {
                const error = new Error('missing') as NodeJS.ErrnoException;
                error.code = 'ENOENT';
                throw error;
            }
            return { size: options.finalSize };
        }),
        truncate,
        unlink: jest.fn(async () => undefined),
    }));
    jest.doMock('./download-reconnect', () => {
        const actual = jest.requireActual('./download-reconnect');
        return {
            ...actual,
            transferWithReconnects: (
                dbArg: unknown,
                task: unknown,
                reservation: unknown
            ) =>
                actual.transferWithReconnects(dbArg, task, reservation, {
                    delayMs: 0,
                }),
        };
    });
    jest.doMock('./download-file-path', () => ({
        getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
        getPartialDownloadSize: jest
            .fn()
            .mockReturnValueOnce(options.partialSize)
            .mockReturnValue(
                options.partialSizeAfterTransferError ?? options.partialSize
            ),
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
        truncate,
        writtenChunks,
        runtime,
    };
}

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

    it('verifies a small validator-less partial from byte zero and appends', async () => {
        // The 50-byte partial fits inside the overlap window: the plain
        // request (no Range) replays it in full for verification and only the
        // 4 new bytes are appended — the .part is never rewritten in place.
        const retainedBytes = Buffer.alloc(50, 7);
        const newBytes = Buffer.alloc(4, 8);
        const harness = await setupResumeHarness({
            finalSize: 54,
            partialSize: 50,
            partialTail: retainedBytes,
            response: {
                data: Readable.from([retainedBytes, newBytes]),
                headers: { 'content-length': '54', etag: '"etag-new"' },
                status: 200,
            },
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                totalBytes: 54,
            })
        );
        await waitForStatus(harness.set, 'completed');

        const requestOptions =
            harness.requestWithValidatedRedirects.mock.calls[0][1];
        expect(requestOptions.headers).toEqual({});
        expect(harness.createWriteStream).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            { flags: 'a' }
        );
        expect(Buffer.concat(harness.writtenChunks)).toEqual(newBytes);
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

    it('resumes without a validator by verifying the overlap window', async () => {
        // Partial: 300,000 bytes; overlap window: last 262,144 → resume at
        // 37,856. The response replays the matching overlap then 16 new bytes.
        const overlapTail = Buffer.alloc(262_144, 7);
        const newBytes = Buffer.alloc(16, 8);
        const harness = await setupResumeHarness({
            finalSize: 300_016,
            partialSize: 300_000,
            partialTail: overlapTail,
            response: {
                data: Readable.from([overlapTail, newBytes]),
                headers: { 'content-range': 'bytes 37856-300015/300016' },
                status: 206,
            },
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                totalBytes: 300_016,
            })
        );
        await waitForStatus(harness.set, 'completed');

        const requestOptions =
            harness.requestWithValidatedRedirects.mock.calls[0][1];
        expect(requestOptions.headers).toEqual({ Range: 'bytes=37856-' });
        expect(harness.createWriteStream).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            { flags: 'a' }
        );
        // Only the bytes past the overlap reach the file.
        expect(Buffer.concat(harness.writtenChunks)).toEqual(newBytes);
        expect(harness.truncate).not.toHaveBeenCalled();
        expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
    });

    it('discards the partial and restarts when the overlap does not match', async () => {
        const overlapTail = Buffer.alloc(262_144, 7);
        const freshBody = Buffer.alloc(16, 8);
        const harness = await setupResumeHarness({
            finalSize: 16,
            partialSize: 300_000,
            // After the mismatch truncates the partial, the restart sees an
            // empty file.
            partialSizeAfterTransferError: 0,
            partialTail: overlapTail,
            responses: [
                {
                    // A different representation: the overlap bytes differ.
                    data: Readable.from([Buffer.alloc(262_144, 9)]),
                    headers: { 'content-range': 'bytes 37856-300015/300016' },
                    status: 206,
                },
                {
                    data: Readable.from([freshBody]),
                    headers: { 'content-length': '16' },
                    status: 200,
                },
            ],
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                totalBytes: 300_016,
            })
        );
        await waitForStatus(harness.set, 'completed');

        expect(harness.truncate).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            0
        );
        const restartOptions =
            harness.requestWithValidatedRedirects.mock.calls[1][1];
        expect(restartOptions.headers).toEqual({});
        // No mismatching byte reached the file; only the fresh body did.
        expect(Buffer.concat(harness.writtenChunks)).toEqual(freshBody);
        expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
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

    it('keeps an unknown total unknown when the overlap stays unverified', async () => {
        // No response ever advertises a total, and each attempt EOFs inside
        // the 20-byte overlap. The failed row must persist totalBytes null —
        // fabricating totalBytes = bytesDownloaded would let Retry's
        // completed-partial shortcut finalize the unverified partial without
        // making a request.
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 20,
            partialTail: Buffer.alloc(20, 'r'),
            response: {
                data: Readable.from([Buffer.alloc(10, 'r')]),
                headers: {},
                status: 200,
            },
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({ filePath: '/downloads/movie.mp4' })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 20,
                    filePath: '/downloads/movie.mp4',
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('never completes at the end of an indeterminate Content-Range', async () => {
        // A 206 with `bytes 40-99/*` and Content-Length 60 describes only the
        // selected range. Deriving a total of 100 from it would declare the
        // 200-byte download complete at byte 100; the known total must be
        // carried instead.
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 40,
            response: {
                data: Readable.from([Buffer.alloc(60, 'r')]),
                headers: {
                    'content-length': '60',
                    'content-range': 'bytes 40-99/*',
                },
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
                    totalBytes: 200,
                })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 100,
                    totalBytes: 200,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('restarts from scratch when the resume range is beyond the shrunken entity (416)', async () => {
        const freshBody = Buffer.alloc(30, 8);
        const harness = await setupResumeHarness({
            finalSize: 30,
            partialSize: 300_000,
            partialSizeAfterTransferError: 0,
            responses: [
                {
                    // A range-capable server whose entity shrank below the
                    // rewound offset rejects the Range outright.
                    requestError: Object.assign(
                        new Error('Request failed with status code 416'),
                        { response: { status: 416 } }
                    ),
                },
                {
                    data: Readable.from([freshBody]),
                    headers: { 'content-length': '30' },
                    status: 200,
                },
            ],
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                totalBytes: 300_016,
            })
        );
        await waitForStatus(harness.set, 'completed');

        expect(harness.truncate).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            0
        );
        const restartOptions =
            harness.requestWithValidatedRedirects.mock.calls[1][1];
        expect(restartOptions.headers).toEqual({});
        expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
    });

    it('restarts instead of completing when the remote entity shrank inside the overlap', async () => {
        // The server's entity is now 100,000 bytes — shorter than the
        // 300,000-byte partial — and its complete 206 ends inside the
        // verification window while matching the overlap's prefix. The old
        // suffix must never be finalized as a completed file.
        const overlapTail = Buffer.alloc(262_144, 7);
        const freshBody = Buffer.alloc(30, 8);
        const harness = await setupResumeHarness({
            finalSize: 30,
            partialSize: 300_000,
            partialSizeAfterTransferError: 0,
            partialTail: overlapTail,
            responses: [
                {
                    data: Readable.from([overlapTail.subarray(0, 62_144)]),
                    headers: { 'content-range': 'bytes 37856-99999/100000' },
                    status: 206,
                },
                {
                    data: Readable.from([freshBody]),
                    headers: { 'content-length': '30' },
                    status: 200,
                },
            ],
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                totalBytes: 300_016,
            })
        );
        await waitForStatus(harness.set, 'completed');

        expect(harness.truncate).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            0
        );
        const restartOptions =
            harness.requestWithValidatedRedirects.mock.calls[1][1];
        expect(restartOptions.headers).toEqual({});
        expect(Buffer.concat(harness.writtenChunks)).toEqual(freshBody);
    });

    it('does not promote a response validator while the overlap is unverified', async () => {
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 20,
            partialTail: Buffer.alloc(20, 'r'),
            response: {
                data: body,
                headers: { 'content-length': '100', etag: '"etag-x"' },
                status: 200,
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
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            // Only half of the 20-byte overlap arrives before the reset.
            body.write(Buffer.alloc(10, 'r'));
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'failed');

            // The unverified partial must never be blessed with the new
            // response's validator — the next resume has to re-verify.
            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ resumeValidator: '"etag-x"' })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('treats a stream ending inside the overlap as an interruption, not a mismatch', async () => {
        const overlapTail = Buffer.alloc(262_144, 7);
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 300_000,
            partialTail: overlapTail,
            response: {
                // EOF after 100,000 matching overlap bytes — nothing appended.
                data: Readable.from([overlapTail.subarray(0, 100_000)]),
                headers: { 'content-range': 'bytes 37856-300015/300016' },
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
                    totalBytes: 300_016,
                })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.truncate).not.toHaveBeenCalled();
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: '/downloads/movie.mp4',
                    status: 'failed',
                })
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('retains the partial and reconnects when the response carries no validator', async () => {
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 0,
            partialSizeAfterTransferError: 20,
            // The reconnect attempts verify the 20 retained bytes from zero.
            partialTail: Buffer.alloc(20, 'r'),
            response: {
                data: body,
                headers: { 'content-length': '100' },
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

            expect(
                harness.requestWithValidatedRedirects.mock.calls.length
            ).toBeGreaterThan(1);
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
            headers: {},
            label: 'response without an advertised total',
            partialSizeAfterTransferError: 20,
        },
        {
            code: 'ECONNRESET',
            headers: { 'content-length': '100' },
            label: 'fresh zero-byte failure',
            partialSizeAfterTransferError: 0,
        },
        {
            code: 'ECONNRESET',
            headers: { 'content-length': '100' },
            label: 'partial larger than the advertised total',
            partialSizeAfterTransferError: 101,
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
