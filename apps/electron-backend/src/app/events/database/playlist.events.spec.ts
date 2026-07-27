type IpcHandler = (
    event: MockIpcEvent,
    ...args: unknown[]
) => Promise<unknown>;

type MockIpcEvent = {
    sender: {
        isDestroyed: jest.Mock<boolean, []>;
        send: jest.Mock;
    };
};

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockWorkerRequest = jest.fn();
const mockWorkerCancel = jest.fn();
const mockCleanupPlaylist = jest.fn();
const mockDestroyAll = jest.fn();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn((channel: string, handler: IpcHandler) => {
            mockRegisteredHandlers.set(channel, handler);
        }),
    },
}));

jest.mock('../../services/database-worker-client', () => ({
    databaseWorkerClient: {
        request: (...args: unknown[]) => mockWorkerRequest(...args),
        cancel: (...args: unknown[]) => mockWorkerCancel(...args),
    },
}));

jest.mock(
    '../../services/stalker-session/stalker-session-runtime',
    () => ({
        stalkerSessionManager: {
            cleanupPlaylist: (...args: unknown[]) =>
                mockCleanupPlaylist(...args),
            destroyAll: (...args: unknown[]) => mockDestroyAll(...args),
        },
    })
);

function createIpcEvent(): MockIpcEvent {
    return {
        sender: {
            isDestroyed: jest.fn(() => false),
            send: jest.fn(),
        },
    };
}

function getHandler(channel: string): IpcHandler {
    const handler = mockRegisteredHandlers.get(channel);

    if (!handler) {
        throw new Error(`Expected IPC handler for ${channel}`);
    }

    return handler;
}

function flushAsyncWork(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe('playlist database session cleanup', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockRegisteredHandlers.clear();
        mockWorkerRequest.mockReset();
        mockWorkerCancel.mockReset();
        mockCleanupPlaylist.mockReset().mockResolvedValue(undefined);
        mockDestroyAll.mockReset().mockResolvedValue(undefined);

        await import('./playlist.events');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('awaits playlist-scoped Stalker cleanup only after the worker deletion succeeds', async () => {
        const deleted = { success: true };
        let resolveDelete!: (value: unknown) => void;
        const deletePending = new Promise((resolve) => {
            resolveDelete = resolve;
        });
        let resolveCleanup!: () => void;
        const cleanupPending = new Promise<void>((resolve) => {
            resolveCleanup = resolve;
        });
        mockWorkerRequest.mockReturnValue(deletePending);
        mockCleanupPlaylist.mockReturnValue(cleanupPending);

        const resultPending = getHandler('DB_DELETE_PLAYLIST')(
            createIpcEvent(),
            'playlist-1',
            'operation-1'
        );
        await Promise.resolve();

        expect(mockCleanupPlaylist).not.toHaveBeenCalled();

        resolveDelete(deleted);
        await flushAsyncWork();

        expect(mockCleanupPlaylist).toHaveBeenCalledWith('playlist-1');

        let settled = false;
        void resultPending.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        resolveCleanup();

        await expect(resultPending).resolves.toBe(deleted);
    });

    it('does not clean a Stalker playlist when the worker deletion fails', async () => {
        const error = new Error('worker-delete-failed');
        mockWorkerRequest.mockRejectedValue(error);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(
            getHandler('DB_DELETE_PLAYLIST')(
                createIpcEvent(),
                'playlist-1',
                'operation-1'
            )
        ).rejects.toBe(error);

        expect(mockCleanupPlaylist).not.toHaveBeenCalled();
        expect(mockDestroyAll).not.toHaveBeenCalled();
    });

    it('awaits complete Stalker session destruction only after delete-all succeeds', async () => {
        const deleted = { success: true };
        mockWorkerRequest.mockResolvedValue(deleted);
        let resolveDestroy!: () => void;
        mockDestroyAll.mockReturnValue(
            new Promise<void>((resolve) => {
                resolveDestroy = resolve;
            })
        );

        const resultPending = getHandler('DB_DELETE_ALL_PLAYLISTS')(
            createIpcEvent(),
            'operation-1'
        );
        await flushAsyncWork();

        expect(mockDestroyAll).toHaveBeenCalledTimes(1);
        expect(mockCleanupPlaylist).not.toHaveBeenCalled();
        expect(mockWorkerRequest.mock.invocationCallOrder[0]).toBeLessThan(
            mockDestroyAll.mock.invocationCallOrder[0]
        );

        let settled = false;
        void resultPending.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        resolveDestroy();

        await expect(resultPending).resolves.toBe(deleted);
    });

    it('does not destroy Stalker sessions when delete-all fails', async () => {
        const error = new Error('worker-delete-all-failed');
        mockWorkerRequest.mockRejectedValue(error);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(
            getHandler('DB_DELETE_ALL_PLAYLISTS')(
                createIpcEvent(),
                'operation-1'
            )
        ).rejects.toBe(error);

        expect(mockDestroyAll).not.toHaveBeenCalled();
        expect(mockCleanupPlaylist).not.toHaveBeenCalled();
    });
});
