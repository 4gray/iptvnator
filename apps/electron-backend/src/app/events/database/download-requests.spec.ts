import type { DownloadDirectoryAuthorizer } from './download-directory-authorization';

describe('download requests resume', () => {
    it('enqueues a paused download with stored headers and original target path', async () => {
        jest.resetModules();

        const row = {
            filePath: '/downloads/movie.mp4',
            id: 42,
            requestHeaders: JSON.stringify({ 'User-Agent': 'IPTVnator' }),
            resumeValidator: '"etag-9"',
            status: 'paused',
            title: 'Movie',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        };
        const limit = jest.fn().mockResolvedValue([row]);
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({ limit })),
                })),
            })),
            update: jest.fn(() => ({
                set: jest.fn(() => ({
                    where: jest.fn().mockResolvedValue(undefined),
                })),
            })),
        };
        const enqueueDownload = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const { resumeDownloadRequest } = await import('./download-requests');

        await expect(
            resumeDownloadRequest(42, '/unused', authorizer)
        ).resolves.toEqual({ success: true });

        expect(authorizer.requireAuthorized).toHaveBeenCalledWith('/downloads');
        expect(enqueueDownload).toHaveBeenCalledWith({
            directory: '/downloads',
            fileName: 'movie.mp4',
            filePath: '/downloads/movie.mp4',
            headers: { 'User-Agent': 'IPTVnator' },
            id: 42,
            resumeValidator: '"etag-9"',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        });
    });

    it('does not enqueue when a concurrent resume already claimed the row', async () => {
        jest.resetModules();

        const row = {
            filePath: '/downloads/movie.mp4',
            id: 42,
            requestHeaders: null,
            resumeValidator: null,
            status: 'paused',
            title: 'Movie',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        };
        const limit = jest.fn().mockResolvedValue([row]);
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({ limit })),
                })),
            })),
            update: jest.fn(() => ({
                set: jest.fn(() => ({
                    // The conditional status='paused' claim matched no rows.
                    where: jest.fn().mockResolvedValue({ changes: 0 }),
                })),
            })),
        };
        const enqueueDownload = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const { resumeDownloadRequest } = await import('./download-requests');

        await expect(
            resumeDownloadRequest(42, '/unused', authorizer)
        ).resolves.toEqual({
            error: 'Can only resume paused downloads',
            success: false,
        });
        expect(enqueueDownload).not.toHaveBeenCalled();
    });

    it('retries a failed download with a retained partial at the original target path', async () => {
        jest.resetModules();

        const row = {
            filePath: '/downloads/movie.mp4',
            id: 42,
            requestHeaders: JSON.stringify({ 'User-Agent': 'IPTVnator' }),
            resumeValidator: '"etag-9"',
            status: 'failed',
            title: 'Movie',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        };
        const limit = jest.fn().mockResolvedValue([row]);
        const set = jest.fn<
            { where: jest.Mock },
            [Record<string, unknown>]
        >(() => ({
            where: jest.fn().mockResolvedValue(undefined),
        }));
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({ limit })),
                })),
            })),
            update: jest.fn(() => ({ set })),
        };
        const enqueueDownload = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const { retryDownloadRequest } = await import('./download-requests');

        await expect(
            retryDownloadRequest(42, '/unused', authorizer)
        ).resolves.toEqual({ success: true });

        const update = set.mock.calls[0][0];
        expect(authorizer.requireAuthorized).toHaveBeenCalledWith('/downloads');
        expect(update).toEqual(
            expect.objectContaining({
                errorMessage: null,
                fileName: 'movie.mp4',
                status: 'queued',
            })
        );
        expect(update).not.toHaveProperty('bytesDownloaded');
        expect(update).not.toHaveProperty('filePath');
        expect(update).not.toHaveProperty('totalBytes');
        expect(enqueueDownload).toHaveBeenCalledWith({
            directory: '/downloads',
            fileName: 'movie.mp4',
            filePath: '/downloads/movie.mp4',
            headers: { 'User-Agent': 'IPTVnator' },
            id: 42,
            resumeValidator: '"etag-9"',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        });
    });

    it('deletes the retained partial before re-downloading a failed row from scratch', async () => {
        jest.resetModules();

        const failedRow = {
            contentType: 'vod',
            filePath: '/downloads/movie.mp4',
            id: 42,
            playlistId: 'playlist-1',
            status: 'failed',
            title: 'Movie',
            url: 'https://example.test/movie.mp4',
            xtreamId: 7,
        };
        const limit = jest
            .fn()
            .mockResolvedValueOnce([{ id: 'playlist-1' }])
            .mockResolvedValueOnce([failedRow]);
        const set = jest.fn<
            { where: jest.Mock },
            [Record<string, unknown>]
        >(() => ({
            where: jest.fn().mockResolvedValue(undefined),
        }));
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({ limit })),
                })),
            })),
            update: jest.fn(() => ({ set })),
        };
        const enqueueDownload = jest.fn();
        const removePartialDownloadFile = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-file-path', () => ({
            removePartialDownloadFile,
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const { startDownloadRequest } = await import('./download-requests');

        await expect(
            startDownloadRequest(
                {
                    contentType: 'vod',
                    downloadFolder: '/downloads',
                    playlistId: 'playlist-1',
                    title: 'Movie',
                    url: 'https://example.test/movie.mp4',
                    xtreamId: 7,
                },
                authorizer
            )
        ).resolves.toEqual({ id: 42, success: true });

        expect(removePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/movie.mp4'
        );
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                filePath: null,
                resumeValidator: null,
                status: 'queued',
            })
        );
    });
});
