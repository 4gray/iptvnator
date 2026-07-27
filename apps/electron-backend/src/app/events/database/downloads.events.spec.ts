import {
    createDownloadRow,
    getHandler,
    mockBroadcastDownloadUpdate,
    mockDownloadRow,
    mockRemoveDownloadFromRuntime,
    mockRemovePartialDownloadFile,
    mockTerminalRows,
    setupDownloadsEventsHarness,
} from './downloads.test-helpers';

describe('downloads events: partial-file cleanup', () => {
    beforeEach(async () => {
        await setupDownloadsEventsHarness();
    });

    it('removes queued resumed partial files before deleting the row', async () => {
        const { deleteWhere } = mockDownloadRow(createDownloadRow('queued'));

        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual(
            {
                success: true,
            }
        );

        expect(mockRemoveDownloadFromRuntime).toHaveBeenCalledWith(42);
        expect(mockRemovePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/resume.mp4'
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(
            mockRemoveDownloadFromRuntime.mock.invocationCallOrder[0]
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(deleteWhere.mock.invocationCallOrder[0]);
        expect(mockBroadcastDownloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('removes completed partial files before deleting the row', async () => {
        const { deleteWhere } = mockDownloadRow(createDownloadRow('completed'));

        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual(
            {
                success: true,
            }
        );

        expect(mockRemovePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/resume.mp4'
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(deleteWhere.mock.invocationCallOrder[0]);
    });

    it('keeps the queued runtime entry and row when partial cleanup fails', async () => {
        const cleanupError = new Error('permission denied');
        const { deleteWhere } = mockDownloadRow(createDownloadRow('queued'));
        mockRemovePartialDownloadFile.mockImplementation(() => {
            throw cleanupError;
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const consoleLog = jest
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);

        try {
            // The row and its .part must survive, but the renderer gets a
            // structured failure it can surface instead of an IPC rejection.
            await expect(
                getHandler('DOWNLOADS_REMOVE')(null, 42)
            ).resolves.toEqual({
                error: 'Could not delete the partial file',
                success: false,
            });
        } finally {
            consoleError.mockRestore();
            consoleLog.mockRestore();
        }

        expect(deleteWhere).not.toHaveBeenCalled();
        expect(mockRemoveDownloadFromRuntime).not.toHaveBeenCalled();
    });

    it('removes completed, failed, and canceled partial files before clearing terminal downloads', async () => {
        const { deleteWhere } = mockTerminalRows([
            { filePath: '/downloads/done.mp4', status: 'completed' },
            { filePath: '/downloads/failed.mp4', status: 'failed' },
            { filePath: '/downloads/canceled.mp4', status: 'canceled' },
        ]);

        await expect(
            getHandler('DOWNLOADS_CLEAR_COMPLETED')(null)
        ).resolves.toEqual({ success: true });

        expect(mockRemovePartialDownloadFile).toHaveBeenCalledTimes(3);
        expect(mockRemovePartialDownloadFile).toHaveBeenNthCalledWith(
            1,
            '/downloads/done.mp4'
        );
        expect(mockRemovePartialDownloadFile).toHaveBeenNthCalledWith(
            2,
            '/downloads/failed.mp4'
        );
        expect(mockRemovePartialDownloadFile).toHaveBeenNthCalledWith(
            3,
            '/downloads/canceled.mp4'
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(deleteWhere.mock.invocationCallOrder[0]);
        expect(mockBroadcastDownloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('retains only downloads whose partial cleanup fails when clearing terminal downloads', async () => {
        const cleanupError = new Error('permission denied');
        const { deleteWhere } = mockTerminalRows([
            { filePath: '/downloads/done.mp4', status: 'completed' },
            { filePath: '/downloads/failed.mp4', status: 'failed' },
        ]);
        mockRemovePartialDownloadFile.mockImplementation((filePath) => {
            if (filePath !== '/downloads/failed.mp4') {
                return;
            }
            throw cleanupError;
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            await expect(
                getHandler('DOWNLOADS_CLEAR_COMPLETED')(null)
            ).resolves.toEqual({ success: true });
        } finally {
            consoleError.mockRestore();
        }

        expect(deleteWhere).toHaveBeenCalledTimes(1);
        expect(mockBroadcastDownloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('removes the row once a previously locked partial becomes deletable', async () => {
        const { deleteWhere } = mockDownloadRow(createDownloadRow('paused'));
        mockRemovePartialDownloadFile
            .mockImplementationOnce(() => {
                throw new Error('EPERM: locked');
            })
            .mockImplementation(() => true);
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const consoleLog = jest
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);

        try {
            await expect(
                getHandler('DOWNLOADS_REMOVE')(null, 42)
            ).resolves.toEqual({
                error: 'Could not delete the partial file',
                success: false,
            });
            expect(deleteWhere).not.toHaveBeenCalled();

            // Retry after the lock is released: cleanup and delete succeed.
            await expect(
                getHandler('DOWNLOADS_REMOVE')(null, 42)
            ).resolves.toEqual({ success: true });
        } finally {
            consoleError.mockRestore();
            consoleLog.mockRestore();
        }

        expect(mockRemovePartialDownloadFile).toHaveBeenCalledTimes(2);
        expect(deleteWhere).toHaveBeenCalledTimes(1);
    });
});
