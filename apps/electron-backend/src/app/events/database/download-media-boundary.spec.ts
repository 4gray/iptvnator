import type { DownloadDirectoryAuthorizer } from './download-directory-authorization';

describe('stored download media boundaries', () => {
    it.each(['resume', 'retry'] as const)(
        'does not %s an executable partial saved by an older release',
        async (action) => {
            jest.resetModules();
            const row = {
                id: 42,
                contentType: 'vod',
                filePath: '/downloads/Movie.cmd',
                status: action === 'resume' ? 'paused' : 'failed',
                title: 'Movie',
                url: 'https://provider.test/movie.mp4',
            };
            const db = {
                select: jest.fn(() => ({
                    from: jest.fn(() => ({
                        where: jest.fn(() => ({ limit: async () => [row] })),
                    })),
                })),
                update: jest.fn(),
            };
            const enqueueDownload = jest.fn();
            jest.doMock('../../database/connection', () => ({
                getDatabase: async () => db,
            }));
            jest.doMock('../url-safety', () => ({
                assertRemoteUrlAllowed: async () => undefined,
            }));
            jest.doMock('./download-runtime', () => ({ enqueueDownload }));
            const requests = await import('./download-resume-requests');
            const request =
                action === 'resume'
                    ? requests.resumeDownloadRequest
                    : requests.retryDownloadRequest;
            const authorizer = {
                requireAuthorized: jest.fn(),
            } as unknown as DownloadDirectoryAuthorizer;

            await expect(request(42, '/downloads', authorizer)).rejects.toThrow(
                'Unsupported download media type'
            );
            expect(db.update).not.toHaveBeenCalled();
            expect(enqueueDownload).not.toHaveBeenCalled();
        }
    );
});
