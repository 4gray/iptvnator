import type { DownloadDirectoryAuthorizer } from './download-directory-authorization';

describe('download requests resume', () => {
    it('enqueues a paused download with stored headers and original target path', async () => {
        jest.resetModules();

        const row = {
            filePath: '/downloads/movie.mp4',
            id: 42,
            requestHeaders: JSON.stringify({ 'User-Agent': 'IPTVnator' }),
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
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        });
    });
});
