type IpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockGetDatabase = jest.fn();
const mockRemoveDownloadFromRuntime = jest.fn();
const mockBroadcastDownloadUpdate = jest.fn();
const mockRemovePartialDownloadFile = jest.fn();
const mockPauseDownload = jest.fn();
const mockResumeDownloadRequest = jest.fn();

function getHandler(channel: string): IpcHandler {
    const handler = mockRegisteredHandlers.get(channel);
    if (!handler) {
        throw new Error(`Expected IPC handler for ${channel}`);
    }

    return handler;
}

function createDownloadRow(status: string) {
    return {
        filePath: '/downloads/resume.mp4',
        status,
    };
}

describe('downloads events', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockRegisteredHandlers.clear();
        mockGetDatabase.mockReset();
        mockRemoveDownloadFromRuntime.mockReset();
        mockBroadcastDownloadUpdate.mockReset();
        mockRemovePartialDownloadFile.mockReset();
        mockPauseDownload.mockReset();
        mockResumeDownloadRequest.mockReset();

        jest.doMock('electron', () => ({
            app: {
                getPath: jest.fn((name: string) =>
                    name === 'userData' ? '/user-data' : '/downloads'
                ),
            },
            dialog: {
                showOpenDialog: jest.fn(),
            },
            ipcMain: {
                handle: jest.fn((channel: string, handler: IpcHandler) => {
                    mockRegisteredHandlers.set(channel, handler);
                }),
            },
            shell: {
                openPath: jest.fn(),
                showItemInFolder: jest.fn(),
            },
        }));
        jest.doMock('../../database/connection', () => ({
            getDatabase: mockGetDatabase,
        }));
        jest.doMock('./download-file-path', () => ({
            removePartialDownloadFile: mockRemovePartialDownloadFile,
        }));
        jest.doMock('./download-runtime', () => ({
            broadcastDownloadUpdate: mockBroadcastDownloadUpdate,
            cancelDownload: jest.fn(),
            pauseDownload: mockPauseDownload,
            removeDownloadFromRuntime: mockRemoveDownloadFromRuntime,
            setMainWindow: jest.fn(),
        }));
        jest.doMock('./download-requests', () => ({
            resumeDownloadRequest: mockResumeDownloadRequest,
            retryDownloadRequest: jest.fn(),
            startDownloadRequest: jest.fn(),
        }));
        jest.doMock('./download-recovery', () => ({
            resetStaleDownloads: jest.fn(),
        }));

        await import('./downloads.events');
    });

    function mockDownloadRow(row: { filePath: string | null; status: string }) {
        const deleteWhere = jest.fn().mockResolvedValue(undefined);
        const db = {
            delete: jest.fn(() => ({ where: deleteWhere })),
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({
                        limit: jest.fn().mockResolvedValue([row]),
                    })),
                })),
            })),
        };
        mockGetDatabase.mockResolvedValue(db);
        return { db, deleteWhere };
    }

    function mockTerminalRows(
        rows: Array<{ filePath: string | null; status: string }>
    ) {
        const deleteWhere = jest.fn().mockResolvedValue(undefined);
        const selectWhere = jest
            .fn()
            .mockResolvedValue(rows.map((row, index) => ({ id: index + 1, ...row })));
        const db = {
            delete: jest.fn(() => ({ where: deleteWhere })),
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: selectWhere,
                })),
            })),
        };
        mockGetDatabase.mockResolvedValue(db);
        return { db, deleteWhere, selectWhere };
    }

    it('removes queued resumed partial files before deleting the row', async () => {
        const { deleteWhere } = mockDownloadRow(createDownloadRow('queued'));

        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual({
            success: true,
        });

        expect(mockRemoveDownloadFromRuntime).toHaveBeenCalledWith(42);
        expect(mockRemovePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/resume.mp4'
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(mockRemoveDownloadFromRuntime.mock.invocationCallOrder[0]);
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(deleteWhere.mock.invocationCallOrder[0]);
        expect(mockBroadcastDownloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('removes completed partial files before deleting the row', async () => {
        const { deleteWhere } = mockDownloadRow(createDownloadRow('completed'));

        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual({
            success: true,
        });

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

        try {
            await expect(
                getHandler('DOWNLOADS_REMOVE')(null, 42)
            ).rejects.toBe(cleanupError);
        } finally {
            consoleError.mockRestore();
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
});
