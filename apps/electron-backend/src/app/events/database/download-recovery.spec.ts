import { cleanupStaleDownloadFiles } from './stale-download-files';

describe('cleanupStaleDownloadFiles', () => {
    it('removes every persisted partial path and ignores empty paths', () => {
        const removeFile = jest.fn();

        cleanupStaleDownloadFiles(
            [
                { filePath: '/downloads/one.mp4' },
                { filePath: null },
                { filePath: '/downloads/two.mp4' },
            ],
            removeFile
        );

        expect(removeFile).toHaveBeenCalledTimes(2);
        expect(removeFile).toHaveBeenNthCalledWith(1, '/downloads/one.mp4');
        expect(removeFile).toHaveBeenNthCalledWith(2, '/downloads/two.mp4');
    });

    it('continues cleaning other stale files after one removal fails', () => {
        const removeFile = jest.fn((filePath: string) => {
            if (filePath.endsWith('one.mp4')) {
                throw new Error('locked');
            }
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        cleanupStaleDownloadFiles(
            [
                { filePath: '/downloads/one.mp4' },
                { filePath: '/downloads/two.mp4' },
            ],
            removeFile
        );

        expect(removeFile).toHaveBeenCalledTimes(2);
        expect(consoleError).toHaveBeenCalledWith(
            '[Downloads] Failed to delete stale partial file:',
            '/downloads/one.mp4',
            expect.any(Error)
        );

        consoleError.mockRestore();
    });
});

describe('resetStaleDownloads', () => {
    it('keeps interrupted partial downloads as paused', async () => {
        jest.resetModules();

        const staleDownloads = [
            {
                filePath: '/downloads/movie.mp4',
                id: 1,
                status: 'downloading',
                totalBytes: 100,
            },
            {
                filePath: null,
                id: 2,
                status: 'queued',
                totalBytes: null,
            },
        ];
        const set = jest.fn(() => ({
            where: jest.fn().mockResolvedValue(undefined),
        }));
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn().mockResolvedValue(staleDownloads),
                })),
            })),
            update: jest.fn(() => ({ set })),
        };

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadSize: jest.fn(() => 64),
        }));

        const { resetStaleDownloads } = await import('./download-recovery');

        await resetStaleDownloads();

        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 64,
                status: 'paused',
            })
        );
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                filePath: null,
                status: 'failed',
            })
        );
    });
});
