import type {
    DbWorkerIncomingMessage,
    DbWorkerMessage,
} from './database-worker.types';
import type {
    PlaylistRefreshWorkerIncomingMessage,
    PlaylistRefreshWorkerMessage,
} from './playlist-refresh.worker.types';

type WorkerMessageHandler<TMessage> = (
    message: TMessage
) => Promise<void> | void;

interface ArmGate {
    readonly promise: Promise<void>;
    readonly release: () => void;
}

function createArmGate(): ArmGate {
    let release = (): void => undefined;
    const promise = new Promise<void>((resolvePromise) => {
        release = resolvePromise;
    });
    return { promise, release };
}

function createParentPortHarness<TIncoming, TOutgoing>() {
    let messageHandler: WorkerMessageHandler<TIncoming> | null = null;
    const postMessage = jest.fn<void, [TOutgoing]>();
    const parentPort = {
        on: jest.fn(
            (event: string, handler: WorkerMessageHandler<TIncoming>): void => {
                if (event === 'message') {
                    messageHandler = handler;
                }
            }
        ),
        postMessage,
    };

    return {
        getMessageHandler: (): WorkerMessageHandler<TIncoming> => {
            if (!messageHandler) {
                throw new Error('Worker message handler was not registered');
            }
            return messageHandler;
        },
        parentPort,
        postMessage,
    };
}

function mockPerformanceCapture(
    armGate: ArmGate,
    failureGates?: {
        readonly observed: ArmGate;
        readonly profilingFinished: ArmGate;
    }
): void {
    jest.doMock('./worker-performance-capture', () => ({
        armWorkerPerformanceCapture: jest.fn(() => armGate.promise),
        executeWithWorkerPerformanceCapture: jest.fn(
            async (_capture: unknown, execute: () => Promise<unknown>) => {
                try {
                    return {
                        error: null,
                        performance: undefined,
                        result: await execute(),
                        success: true,
                    };
                } catch (error) {
                    failureGates?.observed.release();
                    await failureGates?.profilingFinished.promise;
                    return {
                        error,
                        performance: undefined,
                        result: undefined,
                        success: false,
                    };
                }
            }
        ),
        registerDatabaseWorkerPerformanceCapture: jest.fn(),
        releaseDatabaseWorkerPerformanceCapture: jest.fn(),
        startWorkerPerformanceCapture: jest.fn(() => ({})),
    }));
}

describe('worker cancellation while performance capture arms', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetModules();
    });

    it('cancels playlist work before file access when cancel arrives during arming', async () => {
        const armGate = createArmGate();
        const profilingFinished = createArmGate();
        const failureObserved = createArmGate();
        const port = createParentPortHarness<
            PlaylistRefreshWorkerIncomingMessage,
            PlaylistRefreshWorkerMessage<unknown>
        >();
        const readFile = jest.fn().mockResolvedValue('#EXTM3U');
        mockPerformanceCapture(armGate, {
            observed: failureObserved,
            profilingFinished,
        });
        jest.doMock('worker_threads', () => ({
            parentPort: port.parentPort,
        }));
        jest.doMock('node:fs/promises', () => ({ readFile }));
        jest.doMock('iptv-playlist-parser', () => ({
            parse: jest.fn(() => ({ items: [] })),
        }));
        jest.doMock('@iptvnator/shared/m3u-utils', () => ({
            createPlaylistObject: jest.fn(() => ({ id: 'playlist-1' })),
            getFilenameFromUrl: jest.fn(() => 'playlist.m3u'),
        }));

        await import('./playlist-refresh.worker');
        port.postMessage.mockClear();
        const handleMessage = port.getMessageHandler();
        const requestPromise = handleMessage({
            type: 'request',
            payload: {
                filePath: '/fixtures/playlist.m3u',
                operationId: 'refresh-1',
                playlistId: 'playlist-1',
                title: 'Fixture',
            },
        });

        await handleMessage({
            type: 'cancel',
            operationId: 'refresh-1',
        });
        armGate.release();
        await failureObserved.promise;

        const cancelledBeforeProfilingFinished =
            port.postMessage.mock.calls.some(
                ([message]) =>
                    message.type === 'event' &&
                    message.event.status === 'cancelled'
            );
        const responseBeforeProfilingFinished =
            port.postMessage.mock.calls.some(
                ([message]) => message.type === 'response'
            );

        profilingFinished.release();
        await requestPromise;

        expect(readFile).not.toHaveBeenCalled();
        expect(cancelledBeforeProfilingFinished).toBe(true);
        expect(responseBeforeProfilingFinished).toBe(false);
        expect(port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                event: expect.objectContaining({
                    operationId: 'refresh-1',
                    status: 'cancelled',
                }),
                type: 'event',
            })
        );
        expect(port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({ name: 'AbortError' }),
                success: false,
                type: 'response',
            })
        );
    });

    it('cancels cancellable database work when cancel arrives during arming', async () => {
        const armGate = createArmGate();
        const port = createParentPortHarness<
            DbWorkerIncomingMessage,
            DbWorkerMessage
        >();
        const saveContent = jest.fn(
            async (
                _db: unknown,
                _playlistId: string,
                _streams: unknown[],
                _type: string,
                control: { checkpoint: () => Promise<void> }
            ) => {
                await control.checkpoint();
                return { count: 0 };
            }
        );
        mockPerformanceCapture(armGate);
        jest.doMock('worker_threads', () => ({
            parentPort: port.parentPort,
        }));
        jest.doMock('./database.worker-connection', () => ({
            closeWorkerDatabase: jest.fn(),
            getWorkerDatabase: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../database/operations/content.operations', () => ({
            saveContent,
        }));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await import('./database.worker');
        port.postMessage.mockClear();
        const handleMessage = port.getMessageHandler();
        const requestPromise = handleMessage({
            type: 'request',
            operation: 'DB_SAVE_CONTENT',
            payload: {
                operationId: 'database-operation-1',
                playlistId: 'playlist-1',
                streams: [],
                type: 'movie',
            },
            requestId: 'request-1',
        });

        await handleMessage({
            type: 'cancel',
            operationId: 'database-operation-1',
        });
        armGate.release();
        await requestPromise;

        expect(saveContent).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                event: expect.objectContaining({
                    operationId: 'database-operation-1',
                    status: 'cancelled',
                }),
                requestId: 'request-1',
                type: 'event',
            })
        );
        expect(port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({ name: 'AbortError' }),
                requestId: 'request-1',
                success: false,
                type: 'response',
            })
        );
    });

    it('does not make an explicitly non-cancellable database operation cancellable during arming', async () => {
        const armGate = createArmGate();
        const port = createParentPortHarness<
            DbWorkerIncomingMessage,
            DbWorkerMessage
        >();
        const deleteAllPlaylists = jest.fn(
            async (
                _db: unknown,
                control: { checkpoint: () => Promise<void> }
            ) => {
                await control.checkpoint();
                return { success: true };
            }
        );
        mockPerformanceCapture(armGate);
        jest.doMock('worker_threads', () => ({
            parentPort: port.parentPort,
        }));
        jest.doMock('./database.worker-connection', () => ({
            closeWorkerDatabase: jest.fn(),
            getWorkerDatabase: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../database/operations/playlist.operations', () => ({
            deleteAllPlaylists,
        }));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await import('./database.worker');
        port.postMessage.mockClear();
        const handleMessage = port.getMessageHandler();
        const requestPromise = handleMessage({
            type: 'request',
            operation: 'DB_DELETE_ALL_PLAYLISTS',
            payload: {
                operationId: 'database-operation-2',
            },
            requestId: 'request-2',
        });

        await handleMessage({
            type: 'cancel',
            operationId: 'database-operation-2',
        });
        armGate.release();
        await requestPromise;

        expect(deleteAllPlaylists).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                requestId: 'request-2',
                result: { success: true },
                success: true,
                type: 'response',
            })
        );
        expect(port.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({
                event: expect.objectContaining({ status: 'cancelled' }),
                requestId: 'request-2',
                type: 'event',
            })
        );
    });
});

describe('database worker performance control messages', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetModules();
    });

    it('handles a post-GC probe without dispatching a database request', async () => {
        const armGate = createArmGate();
        armGate.release();
        const port = createParentPortHarness<unknown, DbWorkerMessage>();
        const getWorkerDatabase = jest.fn().mockResolvedValue({});
        const handlePostGcHeapRequest = jest.fn();
        const responsePort = { marker: 'response-port' };
        mockPerformanceCapture(armGate);
        jest.doMock('worker_threads', () => ({
            parentPort: port.parentPort,
        }));
        jest.doMock('./database.worker-connection', () => ({
            closeWorkerDatabase: jest.fn(),
            getWorkerDatabase,
        }));
        jest.doMock('./database-worker-post-gc-heap', () => ({
            handleDatabaseWorkerPostGcHeapRequest: handlePostGcHeapRequest,
            isDatabaseWorkerPostGcHeapRequest: jest.fn(
                (message: unknown) =>
                    typeof message === 'object' &&
                    message !== null &&
                    (message as Record<string, unknown>)['type'] ===
                        'performance:collect-post-gc-heap'
            ),
        }));

        await import('./database.worker');
        port.postMessage.mockClear();
        const handleMessage = port.getMessageHandler();
        const message = {
            type: 'performance:collect-post-gc-heap',
            responsePort,
        };

        await handleMessage(message);

        expect(handlePostGcHeapRequest).toHaveBeenCalledWith(message, true);
        expect(getWorkerDatabase).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });
});
