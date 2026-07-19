describe('resetStaleDownloads', () => {
    it('keeps interrupted partial downloads as paused and pauses queued rows', async () => {
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
        const removePartialDownloadFile = jest.fn();

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadSize: jest.fn(() => 64),
            removePartialDownloadFile,
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
                bytesDownloaded: 0,
                status: 'paused',
            })
        );
        expect(set).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed' })
        );
        expect(removePartialDownloadFile).not.toHaveBeenCalled();
    });

    it('keeps the retained partial of a resumed download that was still queued', async () => {
        jest.resetModules();

        const staleDownloads = [
            {
                filePath: '/downloads/resumed.mp4',
                id: 7,
                status: 'queued',
                totalBytes: 1000,
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
        const removePartialDownloadFile = jest.fn();

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadSize: jest.fn(() => 900),
            removePartialDownloadFile,
        }));

        const { resetStaleDownloads } = await import('./download-recovery');

        await resetStaleDownloads();

        expect(removePartialDownloadFile).not.toHaveBeenCalled();
        expect(set).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 900,
                errorMessage: null,
                status: 'paused',
                totalBytes: 1000,
            })
        );
    });

    it('removes non-recoverable interrupted partial files before clearing the persisted path', async () => {
        jest.resetModules();

        const staleDownloads = [
            {
                filePath: '/downloads/empty.mp4',
                id: 1,
                status: 'downloading',
                totalBytes: 100,
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
        const removePartialDownloadFile = jest.fn();

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadSize: jest.fn(() => 0),
            removePartialDownloadFile,
        }));

        const { resetStaleDownloads } = await import('./download-recovery');

        await resetStaleDownloads();

        expect(removePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/empty.mp4'
        );
        expect(removePartialDownloadFile.mock.invocationCallOrder[0]).toBeLessThan(
            set.mock.invocationCallOrder[0]
        );
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                errorMessage: 'Download interrupted by application restart',
                filePath: null,
                status: 'failed',
            })
        );
    });

    it('keeps the persisted path when non-recoverable partial cleanup fails', async () => {
        jest.resetModules();

        const staleDownloads = [
            {
                filePath: '/downloads/locked.mp4',
                id: 1,
                status: 'downloading',
                totalBytes: 100,
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
        const deleteError = new Error('permission denied');
        const removePartialDownloadFile = jest.fn(() => {
            throw deleteError;
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadSize: jest.fn(() => 0),
            removePartialDownloadFile,
        }));

        const { resetStaleDownloads } = await import('./download-recovery');

        try {
            await resetStaleDownloads();

            expect(removePartialDownloadFile).toHaveBeenCalledWith(
                '/downloads/locked.mp4'
            );
            const failedUpdate = (set.mock.calls as unknown[][]).find(
                ([value]) =>
                    (value as { status?: string } | undefined)?.status ===
                    'failed'
            )?.[0] as Record<string, unknown> | undefined;
            expect(failedUpdate).toEqual(
                expect.objectContaining({
                    errorMessage: 'Download interrupted by application restart',
                    status: 'failed',
                })
            );
            expect(failedUpdate).not.toHaveProperty('filePath');
            expect(consoleError).toHaveBeenCalledWith(
                '[Downloads] Failed to delete interrupted partial file:',
                '/downloads/locked.mp4',
                deleteError
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('removes leftover partial files for completed downloads without changing their status', async () => {
        jest.resetModules();

        const downloads = [
            {
                filePath: '/downloads/movie.mp4',
                id: 1,
                status: 'completed',
                totalBytes: 100,
            },
        ];
        const set = jest.fn(() => ({
            where: jest.fn().mockResolvedValue(undefined),
        }));
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn().mockResolvedValue(downloads),
                })),
            })),
            update: jest.fn(() => ({ set })),
        };
        const removePartialDownloadFile = jest.fn();

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadSize: jest.fn(),
            removePartialDownloadFile,
        }));

        const { resetStaleDownloads } = await import('./download-recovery');

        await resetStaleDownloads();

        expect(removePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/movie.mp4'
        );
        expect(set).not.toHaveBeenCalled();
    });

    it('keeps completed downloads completed when leftover partial cleanup still fails', async () => {
        jest.resetModules();

        const downloads = [
            {
                filePath: '/downloads/movie.mp4',
                id: 1,
                status: 'completed',
                totalBytes: 100,
            },
        ];
        const set = jest.fn(() => ({
            where: jest.fn().mockResolvedValue(undefined),
        }));
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn().mockResolvedValue(downloads),
                })),
            })),
            update: jest.fn(() => ({ set })),
        };
        const cleanupError = new Error('locked');
        const removePartialDownloadFile = jest.fn(() => {
            throw cleanupError;
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadSize: jest.fn(),
            removePartialDownloadFile,
        }));

        const { resetStaleDownloads } = await import('./download-recovery');

        try {
            await resetStaleDownloads();

            expect(removePartialDownloadFile).toHaveBeenCalledWith(
                '/downloads/movie.mp4'
            );
            expect(set).not.toHaveBeenCalled();
            expect(consoleError).toHaveBeenCalledWith(
                '[Downloads] Failed to delete completed partial file:',
                '/downloads/movie.mp4',
                cleanupError
            );
        } finally {
            consoleError.mockRestore();
        }
    });
});
