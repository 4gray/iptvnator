import { PassThrough, Readable } from 'node:stream';
import {
    createTask,
    setupResumeHarness,
    waitForStatus,
} from './download-resume.test-helpers';

jest.setTimeout(20_000);

describe('download overlap resume', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        warnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('promotes the validator once the overlap verified, even on a mid-append reset', async () => {
        // The overlap fully matched before the reset, so the proof holds: the
        // retained failure must carry the response's validator into the row,
        // sparing every later attempt another 256 KiB replay.
        const retainedBytes = Buffer.alloc(50, 7);
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 50,
            partialSizeAfterTransferError: 60,
            partialTail: retainedBytes,
            response: {
                data: body,
                headers: { 'content-length': '200', etag: '"etag-proven"' },
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
                    totalBytes: 200,
                })
            );
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            // Full overlap replays, then 10 appended bytes, then the reset.
            body.write(retainedBytes);
            body.write(Buffer.alloc(10, 8));
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    resumeValidator: '"etag-proven"',
                    status: 'failed',
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('finalizes the partial when a 416 confirms its exact length', async () => {
        // A resume at EOF answered with `416` + `Content-Range: bytes */100`
        // confirms the 100-byte partial IS the complete entity — truncating
        // and redownloading it would loop forever on a server that always
        // resets after its last byte.
        const harness = await setupResumeHarness({
            finalSize: 100,
            partialSize: 100,
            responses: [
                {
                    requestError: Object.assign(
                        new Error('Request failed with status code 416'),
                        {
                            response: {
                                headers: { 'content-range': 'bytes */100' },
                                status: 416,
                            },
                        }
                    ),
                },
            ],
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                resumeValidator: '"etag-1"',
                totalBytes: 100,
            })
        );
        await waitForStatus(harness.set, 'completed');

        expect(harness.truncate).not.toHaveBeenCalled();
        expect(harness.set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 100,
                status: 'completed',
                totalBytes: 100,
            })
        );
    });

    it('drops a carried total that a clean indeterminate delivery outgrew', async () => {
        // The partial grows past the stale 250-byte total via a clean
        // `bytes 200-299/*` delivery: both the row and the live task must
        // settle the falsified total to null, or the reconnect's resume
        // guard would reject the partial into generic cleanup.
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 200,
            partialSizeAfterTransferError: 300,
            responses: [
                {
                    data: Readable.from([Buffer.alloc(100, 'r')]),
                    headers: { 'content-range': 'bytes 200-299/*' },
                    status: 206,
                },
                {
                    data: Readable.from([]),
                    headers: { 'content-range': 'bytes 300-349/*' },
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
                    totalBytes: 250,
                })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 300,
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('drops a carried total an indeterminate range can exactly reach', async () => {
        // `bytes 200-249/*` can deliver the partial exactly TO the carried
        // 250: keeping that total would leave a 250/250 row (even via a
        // mid-stream pause) for the completed-partial shortcut, though `/*`
        // explicitly withheld the entity's length.
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 200,
            partialSizeAfterTransferError: 250,
            responses: [
                {
                    data: Readable.from([Buffer.alloc(50, 'r')]),
                    headers: { 'content-range': 'bytes 200-249/*' },
                    status: 206,
                },
                {
                    data: Readable.from([]),
                    headers: { 'content-range': 'bytes 250-299/*' },
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
                    totalBytes: 250,
                })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ totalBytes: 250 })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 250,
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('arms the EOF probe after a reset-ended verified zero-growth replay', async () => {
        // The full overlap replays and the connection resets right at the
        // partial's end — same as the clean-EOF case, the next attempt must
        // probe the byte after the partial and honor the confirming 416.
        const overlapTail = Buffer.alloc(262_144, 7);
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 300_000,
            partialSize: 300_000,
            partialTail: overlapTail,
            responses: [
                {
                    data: body,
                    headers: { 'content-range': 'bytes 37856-299999/*' },
                    status: 206,
                },
                {
                    requestError: Object.assign(
                        new Error('Request failed with status code 416'),
                        {
                            response: {
                                headers: { 'content-range': 'bytes */300000' },
                                status: 416,
                            },
                        }
                    ),
                },
            ],
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({ filePath: '/downloads/movie.mp4' })
            );
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            body.write(overlapTail);
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'completed');

            const probeOptions =
                harness.requestWithValidatedRedirects.mock.calls[1][1];
            expect(probeOptions.headers).toEqual({
                'Accept-Encoding': 'identity',
                Range: 'bytes=300000-',
            });
            expect(harness.truncate).not.toHaveBeenCalled();
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 300_000,
                    status: 'completed',
                    totalBytes: 300_000,
                })
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('probes EOF after a verified zero-growth replay and honors the confirming 416', async () => {
        // The 300,000-byte validator-less partial already IS the complete
        // unknown-length entity: the rewound replay verifies and appends
        // nothing, so the next attempt asks for byte 300,000 outright and the
        // 416's `bytes */300000` confirms completion.
        const overlapTail = Buffer.alloc(262_144, 7);
        const harness = await setupResumeHarness({
            finalSize: 300_000,
            partialSize: 300_000,
            partialTail: overlapTail,
            responses: [
                {
                    data: Readable.from([overlapTail]),
                    headers: { 'content-range': 'bytes 37856-299999/*' },
                    status: 206,
                },
                {
                    requestError: Object.assign(
                        new Error('Request failed with status code 416'),
                        {
                            response: {
                                headers: { 'content-range': 'bytes */300000' },
                                status: 416,
                            },
                        }
                    ),
                },
            ],
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({ filePath: '/downloads/movie.mp4' })
            );
            await waitForStatus(harness.set, 'completed');

            const probeOptions =
                harness.requestWithValidatedRedirects.mock.calls[1][1];
            expect(probeOptions.headers).toEqual({
                'Accept-Encoding': 'identity',
                Range: 'bytes=300000-',
            });
            expect(harness.truncate).not.toHaveBeenCalled();
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 300_000,
                    status: 'completed',
                    totalBytes: 300_000,
                })
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('retains the partial when the EOF probe collects an inconclusive 416', async () => {
        // The probe's 416 carries no `bytes */N`: equally consistent with a
        // complete file, so the partial must survive — restarting would
        // redownload a likely finished movie forever.
        const overlapTail = Buffer.alloc(262_144, 7);
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 300_000,
            partialTail: overlapTail,
            responses: [
                {
                    data: Readable.from([overlapTail]),
                    headers: { 'content-range': 'bytes 37856-299999/*' },
                    status: 206,
                },
                {
                    requestError: Object.assign(
                        new Error('Request failed with status code 416'),
                        { response: { headers: {}, status: 416 } }
                    ),
                },
                {
                    // Later rewound attempts see the same zero-growth range.
                    data: Readable.from([]),
                    headers: { 'content-range': 'bytes 37856-299999/*' },
                    status: 206,
                },
            ],
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({ filePath: '/downloads/movie.mp4' })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.truncate).not.toHaveBeenCalled();
            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 300_000,
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('retains a validator-backed partial whose EOF resume collects a length-less 416', async () => {
        // The If-Range resume at the partial's exact end is itself an EOF
        // probe: a 416 without the optional length must retain the file, not
        // truncate and redownload it.
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 100,
            partialSizeAfterTransferError: 200,
            responses: [
                {
                    data: Readable.from([Buffer.alloc(100, 'r')]),
                    headers: { 'content-range': 'bytes 100-199/*' },
                    status: 206,
                },
                {
                    requestError: Object.assign(
                        new Error('Request failed with status code 416'),
                        { response: { headers: {}, status: 416 } }
                    ),
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
            await waitForStatus(harness.set, 'failed');

            expect(harness.truncate).not.toHaveBeenCalled();
            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 200,
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('drops a carried total the advertised range end contradicts before any byte lands', async () => {
        // `bytes 200-299/*` proves the entity extends to at least 300 — the
        // carried 250 must fall immediately, or a pause while the delivery
        // stops exactly at 250 leaves an N/N row the completed-partial
        // shortcut would finalize.
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 200,
            partialSizeAfterTransferError: 250,
            responses: [
                {
                    data: body,
                    headers: { 'content-range': 'bytes 200-299/*' },
                    status: 206,
                },
                {
                    data: Readable.from([]),
                    headers: { 'content-range': 'bytes 250-299/*' },
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
                    totalBytes: 250,
                })
            );
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            // Only 50 of the advertised 100 bytes arrive before the reset —
            // the file stops exactly at the stale total.
            body.write(Buffer.alloc(50, 'r'));
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'failed');

            // No persisted state may pair the stale total with any progress.
            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ totalBytes: 250 })
            );
            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 250,
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('never completes a bare length-match 416 on a rewound request', async () => {
        // Without If-Range or a verified probe, `bytes */300000` proves only
        // the LENGTH — not whose bytes are on disk. A same-sized different
        // representation must not be finalized; the contradictory 416 (the
        // stated total says the rewound range was satisfiable) retains.
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 300_000,
            responses: [
                {
                    requestError: Object.assign(
                        new Error('Request failed with status code 416'),
                        {
                            response: {
                                headers: { 'content-range': 'bytes */300000' },
                                status: 416,
                            },
                        }
                    ),
                },
            ],
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({ filePath: '/downloads/movie.mp4' })
            );
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.truncate).not.toHaveBeenCalled();
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 300_000,
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('pauses with the promoted total, never a stale carried one, after a verified overlap', async () => {
        // Carried total 100, real total 200. The user pauses exactly while
        // the partial sits at 100: without the error-path total promotion the
        // paused row would read 100/100 and Resume's completed-partial
        // shortcut would finalize the half-finished file.
        const retainedBytes = Buffer.alloc(50, 7);
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 50,
            partialSizeAfterTransferError: 100,
            partialTail: retainedBytes,
            response: {
                data: body,
                headers: { 'content-length': '200', etag: '"etag-proven"' },
                status: 200,
            },
        });

        harness.runtime.enqueueDownload(
            createTask({
                filePath: '/downloads/movie.mp4',
                totalBytes: 100,
            })
        );
        while (harness.requestWithValidatedRedirects.mock.calls.length < 1) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }

        // Full overlap verifies, 50 more bytes land (partial reaches the
        // stale total), then the user pauses.
        body.write(retainedBytes);
        body.write(Buffer.alloc(50, 8));
        await new Promise<void>((resolve) => setImmediate(resolve));
        await harness.runtime.pauseDownload(42);
        await waitForStatus(harness.set, 'paused');

        expect(harness.set).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: 'completed' })
        );
        expect(harness.set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 100,
                resumeValidator: '"etag-proven"',
                status: 'paused',
                totalBytes: 200,
            })
        );
        expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
    });

    it('restarts when a reset-ended response delivered its complete shorter entity inside the overlap', async () => {
        // The changed entity (100,000 bytes) matches the retained prefix and
        // resets right after its final byte, still inside the 262,144-byte
        // window: the same shrink the clean-EOF path restarts on.
        const overlapTail = Buffer.alloc(262_144, 7);
        const freshBody = Buffer.alloc(30, 8);
        const shorterDelivery = overlapTail.subarray(0, 62_144);
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 30,
            partialSize: 300_000,
            partialSizeAfterTransferError: 0,
            partialTail: overlapTail,
            responses: [
                {
                    data: body,
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
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            body.write(shorterDelivery);
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'completed');

            expect(harness.truncate).toHaveBeenCalledWith(
                '/downloads/movie.mp4.part',
                0
            );
            expect(Buffer.concat(harness.writtenChunks)).toEqual(freshBody);
        } finally {
            consoleError.mockRestore();
        }
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
        expect(requestOptions.headers).toEqual({
            'Accept-Encoding': 'identity',
        });
        expect(harness.createWriteStream).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            { flags: 'a' }
        );
        expect(Buffer.concat(harness.writtenChunks)).toEqual(newBytes);
        expect(harness.truncate).not.toHaveBeenCalled();
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
        expect(requestOptions.headers).toEqual({
            'Accept-Encoding': 'identity',
            Range: 'bytes=37856-',
        });
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
        expect(restartOptions.headers).toEqual({
            'Accept-Encoding': 'identity',
        });
        // No mismatching byte reached the file; only the fresh body did.
        expect(Buffer.concat(harness.writtenChunks)).toEqual(freshBody);
        expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
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
    it('retains a range-capable partial after its stale carried total is falsified', async () => {
        // The previous response advertised a 250-byte total, but this 206's
        // indeterminate range extends past it. When the reset lands with the
        // partial at 250, the falsified total must neither complete the
        // download nor push it into generic partial-deleting cleanup.
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 40,
            // The partial crosses the stale 250-byte total: only a task kept
            // in sync with the falsified-total retention lets the reconnect's
            // getResumeOffset accept it.
            partialSizeAfterTransferError: 260,
            responses: [
                {
                    data: body,
                    headers: { 'content-range': 'bytes 40-299/*' },
                    status: 206,
                },
                {
                    // Reconnects resume past the falsified total's edge.
                    data: Readable.from([]),
                    headers: { 'content-range': 'bytes 260-299/*' },
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
                    totalBytes: 250,
                })
            );
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            body.write(Buffer.alloc(220, 'r'));
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
                    bytesDownloaded: 260,
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
    it('keeps the response total uncommitted while the overlap is unverified', async () => {
        // The response advertises exactly the partial's size. Committing that
        // total before the overlap matched would leave an N/N row that the
        // completed-partial shortcut finalizes without another request after
        // a pause, crash, or retained failure.
        const overlapTail = Buffer.alloc(262_144, 7);
        const body = new PassThrough();
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 300_000,
            partialTail: overlapTail,
            response: {
                data: body,
                headers: { 'content-range': 'bytes 37856-299999/300000' },
                status: 206,
            },
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            harness.runtime.enqueueDownload(
                createTask({ filePath: '/downloads/movie.mp4' })
            );
            while (
                harness.requestWithValidatedRedirects.mock.calls.length < 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            // Only part of the overlap arrives before the reset.
            body.write(overlapTail.subarray(0, 100_000));
            const resetError = new Error(
                'socket hang up'
            ) as NodeJS.ErrnoException;
            resetError.code = 'ECONNRESET';
            body.destroy(resetError);
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ totalBytes: 300_000 })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 300_000,
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
                    // rewound offset rejects the Range and STATES the new
                    // length — only that proof authorizes the restart.
                    requestError: Object.assign(
                        new Error('Request failed with status code 416'),
                        {
                            response: {
                                headers: { 'content-range': 'bytes */30' },
                                status: 416,
                            },
                        }
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
        expect(restartOptions.headers).toEqual({
            'Accept-Encoding': 'identity',
        });
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
        expect(restartOptions.headers).toEqual({
            'Accept-Encoding': 'identity',
        });
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
    it('stays incomplete when an indeterminate range ends cleanly at its advertised end', async () => {
        // A range-capping server closing cleanly at Y of `bytes X-Y/*` looks
        // exactly like entity EOF but proves nothing about the entity's end:
        // the transfer must remain incomplete and retained, never finalized.
        const harness = await setupResumeHarness({
            finalSize: 'enoent',
            partialSize: 50,
            partialSizeAfterTransferError: 100,
            responses: [
                {
                    data: Readable.from([Buffer.alloc(50, 'r')]),
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
            await waitForStatus(harness.set, 'failed');

            expect(harness.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
            expect(harness.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    bytesDownloaded: 100,
                    errorMessage: 'Transfer ended before the advertised size',
                    status: 'failed',
                    totalBytes: null,
                })
            );
            expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
});
