import type { OperationControl } from '../database/operations/operation-control';
import type {
    DbWorkerIncomingMessage,
    DbWorkerMessage,
    DbWorkerRequestMessage,
} from './database-worker.types';
import {
    createArmGate,
    createParentPortHarness,
} from './worker-performance-cancellation.test-helpers';

describe('database worker operation lifecycle', () => {
    const envNames = [
        'IPTVNATOR_PERF_WORKER_PROFILING',
        'IPTVNATOR_DB_WORKER_BATCH_DELAY_MS',
    ] as const;
    const originalEnv = envNames.map(
        (name) => [name, process.env[name]] as const
    );
    let originalExitListeners: Array<(code: number) => void>;
    let port: ReturnType<
        typeof createParentPortHarness<DbWorkerIncomingMessage, DbWorkerMessage>
    >;
    let handle: ReturnType<typeof port.getMessageHandler>;
    let saveContent: jest.Mock;
    let deletePlaylist: jest.Mock;
    let deleteAllPlaylists: jest.Mock;

    function saveRequest(
        requestId: string,
        operationId = requestId
    ): DbWorkerRequestMessage {
        return {
            type: 'request',
            requestId,
            operation: 'DB_SAVE_CONTENT',
            payload: {
                playlistId: requestId,
                operationId,
                streams: [{ stream_id: 7 }],
                type: 'movie',
            },
        };
    }

    function messages(requestId: string): DbWorkerMessage[] {
        return port.postMessage.mock.calls
            .map(([message]) => message)
            .filter(
                (message) =>
                    'requestId' in message && message.requestId === requestId
            );
    }

    function lifecycle(requestId: string): string[] {
        return messages(requestId).flatMap((message) =>
            message.type === 'event'
                ? [message.event.status]
                : message.type === 'response'
                  ? ['response']
                  : []
        );
    }

    beforeEach(async () => {
        for (const name of envNames) delete process.env[name];
        originalExitListeners = process.listeners('exit');
        port = createParentPortHarness<
            DbWorkerIncomingMessage,
            DbWorkerMessage
        >();
        saveContent = jest.fn().mockResolvedValue({ success: true, count: 1 });
        deletePlaylist = jest.fn().mockResolvedValue({ success: true });
        deleteAllPlaylists = jest.fn().mockResolvedValue({ success: true });
        jest.doMock('worker_threads', () => ({
            ...jest.requireActual('worker_threads'),
            parentPort: port.parentPort,
            workerData: {},
        }));
        jest.doMock('./database.worker-connection', () => ({
            closeWorkerDatabase: jest.fn(),
            flushWorkerSqlStatementCount: jest.fn(),
            getWorkerDatabase: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../database/operations/content.operations', () => ({
            saveContent,
        }));
        jest.doMock('../database/operations/playlist.operations', () => ({
            deletePlaylist,
            deleteAllPlaylists,
        }));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        await import('./database.worker');
        handle = port.getMessageHandler();
        port.postMessage.mockClear();
    });

    afterEach(() => {
        for (const listener of process.listeners('exit')) {
            if (!originalExitListeners.includes(listener))
                process.removeListener('exit', listener);
        }
        for (const [name, value] of originalEnv) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        jest.restoreAllMocks();
        jest.resetModules();
    });

    it('cancels only the requested concurrent import and correlates every terminal event and response', async () => {
        const entered = { first: createArmGate(), second: createArmGate() };
        const resume = createArmGate();
        saveContent.mockImplementation(
            async (
                _db: unknown,
                playlistId: 'first' | 'second',
                _streams: unknown[],
                _type: string,
                control: OperationControl
            ) => {
                await control.onProgress?.({
                    phase: 'saving-content',
                    current: 1,
                    total: 2,
                    increment: 1,
                });
                entered[playlistId].release();
                await resume.promise;
                await control.checkpoint?.();
                return { success: true, count: 2 };
            }
        );
        const first = handle(saveRequest('first', 'operation-first'));
        const second = handle(saveRequest('second', 'operation-second'));
        await Promise.all([entered.first.promise, entered.second.promise]);
        await handle({ type: 'cancel', operationId: 'unrelated' });
        await handle({ type: 'cancel', operationId: 'operation-first' });
        expect(lifecycle('first')).toEqual(['started', 'progress']);
        expect(lifecycle('second')).toEqual(['started', 'progress']);
        resume.release();
        await Promise.all([first, second]);

        expect(lifecycle('first')).toEqual([
            'started',
            'progress',
            'cancelled',
            'response',
        ]);
        expect(lifecycle('second')).toEqual([
            'started',
            'progress',
            'completed',
            'response',
        ]);
        for (const requestId of ['first', 'second']) {
            for (const message of messages(requestId)) {
                if (message.type === 'event') {
                    expect(message.event).toMatchObject({
                        operationId: `operation-${requestId}`,
                        playlistId: requestId,
                        operation: 'save-content',
                    });
                }
            }
        }
        expect(messages('first').at(-1)).toMatchObject({
            type: 'response',
            requestId: 'first',
            success: false,
            error: { name: 'AbortError' },
        });
        expect(messages('second').at(-1)).toMatchObject({
            type: 'response',
            requestId: 'second',
            success: true,
            result: { count: 2 },
        });

        saveContent.mockResolvedValue({ success: true, count: 1 });
        await handle(saveRequest('retry', 'operation-first'));
        expect(lifecycle('retry')).toEqual([
            'started',
            'completed',
            'response',
        ]);
        expect(messages('retry').at(-1)).toMatchObject({ success: true });
    });

    it.each([
        new Error('synthetic delete failure'),
        'synthetic delete failure',
    ])(
        'returns a failed deletion without a completed event and can process the next request (%s)',
        async (error) => {
            deletePlaylist.mockRejectedValue(error);
            await handle({
                type: 'request',
                requestId: 'delete',
                operation: 'DB_DELETE_PLAYLIST',
                payload: {
                    playlistId: 'saved-playlist',
                    operationId: 'delete-operation',
                },
            });
            expect(deletePlaylist).toHaveBeenCalledWith(
                {},
                'saved-playlist',
                expect.any(Object),
                undefined
            );
            expect(lifecycle('delete')).toEqual([
                'started',
                'error',
                'response',
            ]);
            expect(messages('delete')[1]).toMatchObject({
                type: 'event',
                event: {
                    operationId: 'delete-operation',
                    playlistId: 'saved-playlist',
                    operation: 'delete-playlist',
                    status: 'error',
                    error: 'synthetic delete failure',
                },
            });
            expect(messages('delete').at(-1)).toMatchObject({
                type: 'response',
                requestId: 'delete',
                success: false,
                error: { message: 'synthetic delete failure' },
            });
            await handle(saveRequest('after-failure'));
            expect(messages('after-failure').at(-1)).toMatchObject({
                success: true,
                result: { count: 1 },
            });
        }
    );

    it('flushes accumulated progress before reporting an import failure', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_000);
        saveContent.mockImplementation(
            async (
                _db: unknown,
                _playlistId: string,
                _streams: unknown[],
                _type: string,
                control: OperationControl
            ) => {
                for (const current of [1, 2]) {
                    await control.onProgress?.({
                        phase: 'saving-content',
                        current,
                        total: 3,
                        increment: 1,
                    });
                }
                expect(lifecycle('failed-import')).toEqual([
                    'started',
                    'progress',
                ]);
                throw new Error('batch failed');
            }
        );
        await handle(saveRequest('failed-import'));
        expect(lifecycle('failed-import')).toEqual([
            'started',
            'progress',
            'progress',
            'error',
            'response',
        ]);
        const progress = messages('failed-import').flatMap((message) =>
            message.type === 'event' && message.event.status === 'progress'
                ? [message.event]
                : []
        );
        expect(
            progress.reduce((sum, event) => sum + (event.increment ?? 0), 0)
        ).toBe(2);
        expect(progress.at(-1)).toMatchObject({ current: 2 });
        expect(messages('failed-import').at(-1)).toMatchObject({
            success: false,
            error: { message: 'batch failed' },
        });
    });

    it('keeps delete-all non-cancellable after it has started', async () => {
        const entered = createArmGate();
        const resume = createArmGate();
        deleteAllPlaylists.mockImplementation(
            async (_db: unknown, control: OperationControl) => {
                entered.release();
                await resume.promise;
                await control.checkpoint?.();
                return { success: true };
            }
        );
        const request = handle({
            type: 'request',
            requestId: 'delete-all',
            operation: 'DB_DELETE_ALL_PLAYLISTS',
            payload: { operationId: 'delete-all-operation' },
        });
        await entered.promise;
        await handle({ type: 'cancel', operationId: 'delete-all-operation' });
        expect(lifecycle('delete-all')).toEqual(['started']);
        resume.release();
        await request;
        expect(lifecycle('delete-all')).toEqual([
            'started',
            'completed',
            'response',
        ]);
        expect(messages('delete-all').at(-1)).toMatchObject({
            success: true,
            result: { success: true },
        });
    });
});
