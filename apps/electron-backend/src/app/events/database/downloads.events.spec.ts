type IpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockGetDatabase = jest.fn();
const mockRemoveDownloadFromRuntime = jest.fn();
const mockBroadcastDownloadUpdate = jest.fn();
const mockRemovePartialDownloadFile = jest.fn();
const mockPauseDownload = jest.fn();
const mockResumeDownloadRequest = jest.fn();
const mockExistsSync = jest.fn();
const mockOpenPath = jest.fn();
const mockShowItemInFolder = jest.fn();
const mockEq = jest.fn();
let downloadsFilePathColumn: unknown;

const MANAGED_PATH_STATE = {
    ERROR: 'error',
    MANAGED: 'managed',
    UNMANAGED: 'unmanaged',
} as const;

type ManagedPathState =
    (typeof MANAGED_PATH_STATE)[keyof typeof MANAGED_PATH_STATE];

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
        mockExistsSync.mockReset();
        mockOpenPath.mockReset().mockResolvedValue('');
        mockShowItemInFolder.mockReset();
        mockEq.mockReset();

        jest.doMock('node:fs', () => ({
            ...jest.requireActual<typeof import('node:fs')>('node:fs'),
            existsSync: mockExistsSync,
        }));
        jest.doMock('drizzle-orm', () => {
            const actual =
                jest.requireActual<typeof import('drizzle-orm')>('drizzle-orm');
            mockEq.mockImplementation(actual.eq);
            return {
                ...actual,
                eq: mockEq,
            };
        });
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
                openPath: mockOpenPath,
                showItemInFolder: mockShowItemInFolder,
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
        const schema = await import('../../database/schema');
        downloadsFilePathColumn = schema.downloads.filePath;
    });

    function mockManagedPath(state: ManagedPathState) {
        const limit = jest.fn(() => {
            if (state === MANAGED_PATH_STATE.ERROR) {
                return Promise.reject(new Error('database unavailable'));
            }
            return Promise.resolve(
                state === MANAGED_PATH_STATE.MANAGED ? [{ id: 42 }] : []
            );
        });
        const where = jest.fn((_predicate: unknown) => ({ limit }));
        const from = jest.fn(() => ({ where }));
        const select = jest.fn(() => ({ from }));
        const db = { select };
        mockGetDatabase.mockResolvedValue(db);
        return { from, limit, select, where };
    }

    function expectManagedPathLookup(
        lookup: ReturnType<typeof mockManagedPath>,
        filePath: string
    ) {
        expect(mockGetDatabase).toHaveBeenCalledTimes(1);
        expect(lookup.select).toHaveBeenCalledTimes(1);
        expect(lookup.from).toHaveBeenCalledTimes(1);
        expect(lookup.where).toHaveBeenCalledTimes(1);
        expect(mockEq).toHaveBeenCalledTimes(1);
        expect(mockEq.mock.calls[0][0] === downloadsFilePathColumn).toBe(true);
        expect(mockEq.mock.calls[0][1]).toBe(filePath);
        expect(
            lookup.where.mock.calls[0][0] === mockEq.mock.results[0].value
        ).toBe(true);
        expect(lookup.limit).toHaveBeenCalledTimes(1);
        expect(lookup.limit).toHaveBeenCalledWith(1);
    }

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
            .mockResolvedValue(
                rows.map((row, index) => ({ id: index + 1, ...row }))
            );
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
            mockExistsSync.mockReturnValue(true);

            await expect(getHandler(channel)(null, filePath)).resolves.toEqual({
                error: 'File not found',
                success: false,
            });

            expectManagedPathLookup(lookup, filePath);
            expect(mockExistsSync).not.toHaveBeenCalled();
            expect(mockOpenPath).not.toHaveBeenCalled();
            expect(mockShowItemInFolder).not.toHaveBeenCalled();
        });

        it('rejects a managed database path that is missing from disk', async () => {
            const lookup = mockManagedPath(MANAGED_PATH_STATE.MANAGED);
            mockExistsSync.mockReturnValue(false);

            await expect(getHandler(channel)(null, filePath)).resolves.toEqual({
                error: 'File not found',
                success: false,
            });

            expectManagedPathLookup(lookup, filePath);
            expect(mockExistsSync).toHaveBeenCalledTimes(1);
            expect(mockExistsSync).toHaveBeenCalledWith(filePath);
            expect(mockOpenPath).not.toHaveBeenCalled();
            expect(mockShowItemInFolder).not.toHaveBeenCalled();
        });

        it('fails closed when the managed-path database query rejects', async () => {
            const lookup = mockManagedPath(MANAGED_PATH_STATE.ERROR);
            mockExistsSync.mockReturnValue(true);
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
            expect(mockExistsSync).not.toHaveBeenCalled();
            expect(mockOpenPath).not.toHaveBeenCalled();
            expect(mockShowItemInFolder).not.toHaveBeenCalled();
        });
    });

    it('reveals a managed file that exists on disk', async () => {
        const filePath = '/downloads/reveal-success.mp4';
        const lookup = mockManagedPath(MANAGED_PATH_STATE.MANAGED);
        mockExistsSync.mockReturnValue(true);

        await expect(
            getHandler('DOWNLOADS_REVEAL_FILE')(null, filePath)
        ).resolves.toEqual({ success: true });

        expectManagedPathLookup(lookup, filePath);
        expect(mockExistsSync).toHaveBeenCalledTimes(1);
        expect(mockExistsSync).toHaveBeenCalledWith(filePath);
        expect(mockShowItemInFolder).toHaveBeenCalledTimes(1);
        expect(mockShowItemInFolder).toHaveBeenCalledWith(filePath);
        expect(mockOpenPath).not.toHaveBeenCalled();
    });

    it('waits for the native shell before reporting a managed file as played', async () => {
        const filePath = '/downloads/play-success.mp4';
        const lookup = mockManagedPath(MANAGED_PATH_STATE.MANAGED);
        mockExistsSync.mockReturnValue(true);
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
        expect(mockExistsSync).toHaveBeenCalledTimes(1);
        expect(mockExistsSync).toHaveBeenCalledWith(filePath);
        expect(mockOpenPath).toHaveBeenCalledTimes(1);
        expect(mockOpenPath).toHaveBeenCalledWith(filePath);
        expect(mockShowItemInFolder).not.toHaveBeenCalled();
        expect(responseSettled).toBe(false);

        resolveOpenPath('');
        await expect(response).resolves.toEqual({ success: true });
    });
});
