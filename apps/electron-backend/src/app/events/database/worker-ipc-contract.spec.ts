import {
    DB_WORKER_OPERATIONS,
    DbOperationEvent,
} from '../../workers/database-worker.types';
import {
    operationId,
    playlistId,
    streams,
    workerIpcContractCases,
} from './worker-ipc-contract.spec-data';

type IpcHandler = (event: MockIpcEvent, ...args: unknown[]) => Promise<unknown>;

type MockIpcEvent = {
    sender: {
        isDestroyed: jest.Mock<boolean, []>;
        send: jest.Mock;
    };
};

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockWorkerRequest = jest.fn();
const mockWorkerCancel = jest.fn();
const mockGetDatabase = jest.fn();

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

jest.mock('../../database/connection', () => ({
    getDatabase: (...args: unknown[]) => mockGetDatabase(...args),
}));

async function importDatabaseEventModules(): Promise<void> {
    await import('./category.events');
    await import('./content.events');
    await import('./favorites.events');
    await import('./playback-position.events');
    await import('./playlist.events');
    await import('./recently-viewed.events');
    await import('./tmdb.events');
    await import('./vod-sources.events');
    await import('./xtream.events');
}

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

function getLastWorkerRequestCall(): unknown[] {
    return mockWorkerRequest.mock.calls[
        mockWorkerRequest.mock.calls.length - 1
    ];
}

describe('database worker IPC contract', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockRegisteredHandlers.clear();
        mockWorkerRequest.mockReset().mockResolvedValue({ success: true });
        mockWorkerCancel.mockReset().mockResolvedValue({ success: true });
        mockGetDatabase.mockReset().mockResolvedValue({});

        await importDatabaseEventModules();
    });

    it('registers an IPC handler for every worker operation', () => {
        const registeredDbChannels = [...mockRegisteredHandlers.keys()]
            .filter(
                (channel) =>
                    ![
                        'DB_CANCEL_OPERATION',
                        'DB_RECOVER_LEGACY_PLAYLISTS',
                    ].includes(channel)
            )
            .sort();

        expect(registeredDbChannels).toEqual([...DB_WORKER_OPERATIONS].sort());
        expect(mockRegisteredHandlers.has('DB_CANCEL_OPERATION')).toBe(true);
        expect(mockRegisteredHandlers.has('DB_RECOVER_LEGACY_PLAYLISTS')).toBe(
            true
        );
    });

    it.each(workerIpcContractCases)(
        '$operation builds the expected worker request payload',
        async ({ operation, args, payload, forwardsEvents }) => {
            const ipcEvent = createIpcEvent();
            const handler = getHandler(operation);

            await handler(ipcEvent, ...args);

            if (forwardsEvents) {
                expect(mockWorkerRequest).toHaveBeenLastCalledWith(
                    operation,
                    payload,
                    { onEvent: expect.any(Function) }
                );
            } else {
                expect(mockWorkerRequest).toHaveBeenLastCalledWith(
                    operation,
                    payload
                );
            }
        }
    );

    it('waits for the migrated schema before dispatching to the worker', async () => {
        // The renderer loads BEFORE `initDatabase()` in main.ts, and the
        // worker opens the database file without running any migration. So a
        // query issued during startup on an upgraded install could reach a
        // schema whose newly added columns do not exist yet, and SQLite would
        // reject it with "no such column" — emptying dashboard activity until
        // the next reload. `getDatabase()` resolves the shared init promise.
        let schemaReady = false;
        mockGetDatabase.mockImplementation(async () => {
            schemaReady = true;
            return {};
        });
        mockWorkerRequest.mockImplementation(async () => {
            expect(schemaReady).toBe(true);
            return { success: true };
        });

        await getHandler('DB_GET_RECENTLY_VIEWED')(createIpcEvent());

        expect(mockGetDatabase).toHaveBeenCalled();
        expect(mockWorkerRequest).toHaveBeenCalled();
    });

    it('never reaches the worker when the schema cannot be prepared', async () => {
        // Failing here rather than querying an unmigrated database: the query
        // would fail anyway, but with an error naming a missing column instead
        // of the real cause.
        mockGetDatabase.mockRejectedValue(new Error('disk full'));

        await expect(
            getHandler('DB_GET_RECENTLY_VIEWED')(createIpcEvent())
        ).rejects.toThrow('disk full');
        expect(mockWorkerRequest).not.toHaveBeenCalled();
    });

    it('covers every worker operation in the payload contract cases', () => {
        expect(
            new Set(workerIpcContractCases.map(({ operation }) => operation))
        ).toEqual(new Set(DB_WORKER_OPERATIONS));
    });

    it('forwards request-scoped worker events only while the renderer exists', async () => {
        const ipcEvent = createIpcEvent();
        const workerEvent: DbOperationEvent = {
            operationId,
            operation: 'save-content',
            status: 'progress',
            current: 5,
            total: 10,
        };

        await getHandler('DB_SAVE_CONTENT')(
            ipcEvent,
            playlistId,
            streams,
            'movie',
            operationId
        );

        const options = getLastWorkerRequestCall()[2] as {
            onEvent: (event: DbOperationEvent) => void;
        };

        options.onEvent(workerEvent);

        expect(ipcEvent.sender.send).toHaveBeenCalledWith(
            'DB_OPERATION_EVENT',
            workerEvent
        );

        ipcEvent.sender.send.mockClear();
        ipcEvent.sender.isDestroyed.mockReturnValue(true);

        options.onEvent(workerEvent);

        expect(ipcEvent.sender.send).not.toHaveBeenCalled();
    });

    it('routes DB cancellation through the worker client cancel channel', async () => {
        const result = await getHandler('DB_CANCEL_OPERATION')(
            createIpcEvent(),
            operationId
        );

        expect(mockWorkerCancel).toHaveBeenCalledWith(operationId);
        expect(result).toEqual({ success: true });
    });
});
