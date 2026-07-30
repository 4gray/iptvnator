import {
    expectManagedPathLookup,
    getHandler,
    MANAGED_PATH_STATE,
    mockLstatSync,
    mockManagedPath,
    mockOpenPath,
    mockPauseDownload,
    mockRedownloadMissingRequest,
    mockResumeDownloadRequest,
    mockShowItemInFolder,
    setupDownloadsEventsHarness,
} from './downloads.test-helpers';

describe('downloads events: pause, resume, and reveal', () => {
    beforeEach(async () => {
        await setupDownloadsEventsHarness();
    });

    it('maps a successful runtime pause to a success response', async () => {
        mockPauseDownload.mockResolvedValue(true);
        const consoleLog = jest
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);

        try {
            await expect(
                getHandler('DOWNLOADS_PAUSE')(null, 42)
            ).resolves.toEqual({ success: true });
        } finally {
            consoleLog.mockRestore();
        }

        expect(mockPauseDownload).toHaveBeenCalledWith(42);
    });

    it('maps an unknown pause target to an error response', async () => {
        mockPauseDownload.mockResolvedValue(false);
        const consoleLog = jest
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);

        try {
            await expect(
                getHandler('DOWNLOADS_PAUSE')(null, 42)
            ).resolves.toEqual({
                error: 'Download not found in queue',
                success: false,
            });
        } finally {
            consoleLog.mockRestore();
        }
    });

    it('forwards resume requests with the download folder and returns the result', async () => {
        mockResumeDownloadRequest.mockResolvedValue({
            error: 'Can only resume paused downloads',
            success: false,
        });

        await expect(
            getHandler('DOWNLOADS_RESUME')(null, 42, '/downloads')
        ).resolves.toEqual({
            error: 'Can only resume paused downloads',
            success: false,
        });

        expect(mockResumeDownloadRequest).toHaveBeenCalledWith(
            42,
            '/downloads',
            expect.anything()
        );
    });

    it('forwards missing-file recovery by managed download id', async () => {
        mockRedownloadMissingRequest.mockResolvedValue({
            recovered: true,
            success: true,
        });

        await expect(
            getHandler('DOWNLOADS_REDOWNLOAD_MISSING')(null, 42)
        ).resolves.toEqual({
            recovered: true,
            success: true,
        });
        expect(mockRedownloadMissingRequest).toHaveBeenCalledWith(42);
    });

    describe.each([
        {
            channel: 'DOWNLOADS_REVEAL_FILE',
            filePath: '/downloads/reveal-boundary.mp4',
            operation: 'reveal',
        },
        {
            channel: 'DOWNLOADS_PLAY_FILE',
            filePath: '/downloads/play-boundary.mp4',
            operation: 'play',
        },
    ])('$operation managed-path boundary', ({ channel, filePath }) => {
        it('rejects an unmanaged database path before accessing the filesystem', async () => {
            const lookup = mockManagedPath(MANAGED_PATH_STATE.UNMANAGED);

            await expect(getHandler(channel)(null, filePath)).resolves.toEqual({
                error: 'File not found',
                success: false,
            });

            expectManagedPathLookup(lookup, filePath);
            expect(mockLstatSync).not.toHaveBeenCalled();
            expect(mockOpenPath).not.toHaveBeenCalled();
            expect(mockShowItemInFolder).not.toHaveBeenCalled();
        });

        it('rejects a managed database path that is missing from disk', async () => {
            const lookup = mockManagedPath(MANAGED_PATH_STATE.MANAGED);
            mockLstatSync.mockImplementation(() => {
                throw new Error('ENOENT');
            });

            await expect(getHandler(channel)(null, filePath)).resolves.toEqual({
                error: 'File not found',
                success: false,
            });

            expectManagedPathLookup(lookup, filePath);
            expect(mockLstatSync).toHaveBeenCalledTimes(1);
            expect(mockLstatSync).toHaveBeenCalledWith(filePath);
            expect(mockOpenPath).not.toHaveBeenCalled();
            expect(mockShowItemInFolder).not.toHaveBeenCalled();
        });

        it.each([
            [
                'directory',
                {
                    isFile: () => false,
                    isSymbolicLink: () => false,
                },
            ],
            [
                'symbolic link',
                {
                    isFile: () => true,
                    isSymbolicLink: () => true,
                },
            ],
        ])('rejects a managed %s', async (_label, stats) => {
            const lookup = mockManagedPath(MANAGED_PATH_STATE.MANAGED);
            mockLstatSync.mockReturnValue(stats);

            await expect(getHandler(channel)(null, filePath)).resolves.toEqual({
                error: 'File not found',
                success: false,
            });

            expectManagedPathLookup(lookup, filePath);
            expect(mockLstatSync).toHaveBeenCalledWith(filePath);
            expect(mockOpenPath).not.toHaveBeenCalled();
            expect(mockShowItemInFolder).not.toHaveBeenCalled();
        });

        it('fails closed when the managed-path database query rejects', async () => {
            const lookup = mockManagedPath(MANAGED_PATH_STATE.ERROR);
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);

            try {
                await expect(
                    getHandler(channel)(null, filePath)
                ).resolves.toEqual({
                    error: 'File not found',
                    success: false,
                });
                expect(consoleError).toHaveBeenCalledTimes(1);
                expect(consoleError).toHaveBeenCalledWith(
                    'Error verifying managed download path:',
                    expect.objectContaining({
                        message: 'database unavailable',
                    })
                );
            } finally {
                consoleError.mockRestore();
            }

            expectManagedPathLookup(lookup, filePath);
            expect(mockLstatSync).not.toHaveBeenCalled();
            expect(mockOpenPath).not.toHaveBeenCalled();
            expect(mockShowItemInFolder).not.toHaveBeenCalled();
        });
    });

    it('reveals a managed file that exists on disk', async () => {
        const filePath = '/downloads/reveal-success.mp4';
        const lookup = mockManagedPath(MANAGED_PATH_STATE.MANAGED);
        mockLstatSync.mockReturnValue({
            isFile: () => true,
            isSymbolicLink: () => false,
        });

        await expect(
            getHandler('DOWNLOADS_REVEAL_FILE')(null, filePath)
        ).resolves.toEqual({ success: true });

        expectManagedPathLookup(lookup, filePath);
        expect(mockLstatSync).toHaveBeenCalledTimes(1);
        expect(mockLstatSync).toHaveBeenCalledWith(filePath);
        expect(mockShowItemInFolder).toHaveBeenCalledTimes(1);
        expect(mockShowItemInFolder).toHaveBeenCalledWith(filePath);
        expect(mockOpenPath).not.toHaveBeenCalled();
    });

    it('waits for the native shell before reporting a managed file as played', async () => {
        const filePath = '/downloads/play-success.mp4';
        const lookup = mockManagedPath(MANAGED_PATH_STATE.MANAGED);
        mockLstatSync.mockReturnValue({
            isFile: () => true,
            isSymbolicLink: () => false,
        });
        let resolveOpenPath!: (value: string) => void;
        const openPathResult = new Promise<string>((resolve) => {
            resolveOpenPath = resolve;
        });
        mockOpenPath.mockReturnValue(openPathResult);

        let responseSettled = false;
        const response = getHandler('DOWNLOADS_PLAY_FILE')(null, filePath).then(
            (result) => {
                responseSettled = true;
                return result;
            }
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expectManagedPathLookup(lookup, filePath);
        expect(mockLstatSync).toHaveBeenCalledTimes(1);
        expect(mockLstatSync).toHaveBeenCalledWith(filePath);
        expect(mockOpenPath).toHaveBeenCalledTimes(1);
        expect(mockOpenPath).toHaveBeenCalledWith(filePath);
        expect(mockShowItemInFolder).not.toHaveBeenCalled();
        expect(responseSettled).toBe(false);

        resolveOpenPath('');
        await expect(response).resolves.toEqual({ success: true });
    });
});
