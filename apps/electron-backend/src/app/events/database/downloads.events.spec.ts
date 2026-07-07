type IpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockGetDatabase = jest.fn();
const mockRemoveDownloadFromRuntime = jest.fn();
const mockBroadcastDownloadUpdate = jest.fn();
const mockRemovePartialDownloadFile = jest.fn();

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
            pauseDownload: jest.fn(),
            removeDownloadFromRuntime: mockRemoveDownloadFromRuntime,
            setMainWindow: jest.fn(),
        }));
        jest.doMock('./download-requests', () => ({
            resumeDownloadRequest: jest.fn(),
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
        ).toBeLessThan(deleteWhere.mock.invocationCallOrder[0]);
        expect(mockBroadcastDownloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('does not delete the row when queued partial cleanup fails', async () => {
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
    });
});
