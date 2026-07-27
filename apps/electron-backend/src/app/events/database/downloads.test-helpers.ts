type IpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

/**
 * Shared harness for the downloads-events specs.
 *
 * The module registry is reset and re-mocked per test via `jest.doMock`, which
 * is deliberately not hoisted — so the whole setup can live here and each spec
 * just calls `setupDownloadsEventsHarness()` from its own `beforeEach`.
 */

export const mockRegisteredHandlers = new Map<string, IpcHandler>();
export const mockGetDatabase = jest.fn();
export const mockRemoveDownloadFromRuntime = jest.fn();
export const mockBroadcastDownloadUpdate = jest.fn();
export const mockRemovePartialDownloadFile = jest.fn();
export const mockPauseDownload = jest.fn();
export const mockResumeDownloadRequest = jest.fn();
export const mockExistsSync = jest.fn();
export const mockOpenPath = jest.fn();
export const mockShowItemInFolder = jest.fn();
export const mockEq = jest.fn();
let downloadsFilePathColumn: unknown;

export const MANAGED_PATH_STATE = {
    ERROR: 'error',
    MANAGED: 'managed',
    UNMANAGED: 'unmanaged',
} as const;

export type ManagedPathState =
    (typeof MANAGED_PATH_STATE)[keyof typeof MANAGED_PATH_STATE];

export function getHandler(channel: string): IpcHandler {
    const handler = mockRegisteredHandlers.get(channel);
    if (!handler) {
        throw new Error(`Expected IPC handler for ${channel}`);
    }

    return handler;
}

export function createDownloadRow(status: string) {
    return {
        filePath: '/downloads/resume.mp4',
        status,
    };
}

export async function setupDownloadsEventsHarness(): Promise<void> {
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
}

export function mockManagedPath(state: ManagedPathState) {
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

export function expectManagedPathLookup(
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

export function mockDownloadRow(row: { filePath: string | null; status: string }) {
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

export function mockTerminalRows(
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
