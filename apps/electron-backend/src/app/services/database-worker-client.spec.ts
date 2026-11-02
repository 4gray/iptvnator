import type { DatabaseWorkerClient as DatabaseWorkerClientType } from './database-worker-client';

const mockWorkerInstances: any[] = [];
const resolveWorkerRuntimeBootstrap = jest.fn();

jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/mock/app.asar',
    },
}));

jest.mock('worker_threads', () => {
    const { EventEmitter } = require('events');

    class MockWorker extends EventEmitter {
        postMessage = jest.fn();
        terminate = jest.fn().mockResolvedValue(0);
    }

    return {
        Worker: jest.fn().mockImplementation(() => {
            const worker = new MockWorker();
            mockWorkerInstances.push(worker);
            return worker;
        }),
    };
});

jest.mock('../workers/worker-runtime-paths', () => ({
    resolveWorkerRuntimeBootstrap: (...args: unknown[]) =>
        resolveWorkerRuntimeBootstrap(...args),
}));

describe('DatabaseWorkerClient', () => {
    let DatabaseWorkerClient: typeof DatabaseWorkerClientType;
    let clients: DatabaseWorkerClientType[];

    beforeEach(async () => {
        jest.resetModules();
        mockWorkerInstances.length = 0;
        resolveWorkerRuntimeBootstrap.mockReset();
        resolveWorkerRuntimeBootstrap.mockReturnValue({
            workerPath: '/mock/workers/database.worker.js',
            workerPathCandidates: ['/mock/workers/database.worker.js'],
            nativeModuleSearchPaths: [
                '/mock/resources/app.asar.unpacked/node_modules',
            ],
        });
        clients = [];
        ({ DatabaseWorkerClient } = await import('./database-worker-client'));
    });

    afterEach(async () => {
        await Promise.all(
            clients.map((client) => client.shutdown().catch(() => undefined))
        );
    });

    function createClient(): DatabaseWorkerClientType {
        const client = new DatabaseWorkerClient();
        clients.push(client);
        return client;
    }

    async function flushPromises(): Promise<void> {
        await new Promise((resolve) => setImmediate(resolve));
    }

    it('resolves requests after the worker reports ready and returns a response', async () => {
        const client = createClient();
        const requestPromise = client.request('DB_GLOBAL_SEARCH', {
            searchTerm: 'matrix',
        });
        const worker = mockWorkerInstances[0];
        const { Worker } = jest.requireMock('worker_threads');

        expect(resolveWorkerRuntimeBootstrap).toHaveBeenCalledWith(
            expect.objectContaining({
                workerFilename: 'database.worker.js',
                developmentWorkerDir: expect.stringContaining('workers'),
            })
        );
        expect(Worker).toHaveBeenCalledWith(expect.any(URL), {
            workerData: {
                nativeModuleSearchPaths: [
                    '/mock/resources/app.asar.unpacked/node_modules',
                ],
                parentalLockActive: false,
            },
        });

        worker.emit('message', { type: 'ready' });
        await flushPromises();

        expect(worker.postMessage).toHaveBeenCalledTimes(1);
        const request = worker.postMessage.mock.calls[0][0];

        worker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: true,
            result: [{ id: 1 }],
        });

        await expect(requestPromise).resolves.toEqual([{ id: 1 }]);
    });

    it('forwards worker events to the pending request callback', async () => {
        const client = createClient();
        const onEvent = jest.fn();
        const requestPromise = client.request(
            'DB_SAVE_CONTENT',
            { playlistId: 'xtream-1', streams: [], type: 'movie' },
            { onEvent }
        );
        const worker = mockWorkerInstances[0];

        worker.emit('message', { type: 'ready' });
        await flushPromises();

        const request = worker.postMessage.mock.calls[0][0];
        const event = {
            operationId: 'op-1',
            operation: 'save-content',
            status: 'progress',
            current: 10,
            total: 100,
        };

        worker.emit('message', {
            type: 'event',
            requestId: request.requestId,
            event,
        });

        expect(onEvent).toHaveBeenCalledWith(event);

        worker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: true,
            result: { success: true, count: 10 },
        });

        await expect(requestPromise).resolves.toEqual({
            success: true,
            count: 10,
        });
    });

    it('ignores profiling-only cancel receipts without settling or exposing the pending request', async () => {
        const client = createClient();
        const onEvent = jest.fn();
        const requestPromise = client.request(
            'DB_DELETE_XTREAM_CONTENT',
            { operationId: 'operation-1', playlistId: 'xtream-1' },
            { onEvent }
        );
        const worker = mockWorkerInstances[0];

        worker.emit('message', { type: 'ready' });
        await flushPromises();

        const request = worker.postMessage.mock.calls[0][0];
        worker.emit('message', {
            type: 'performance-cancel-received',
            operationId: 'operation-1',
            requestId: request.requestId,
            epochMs: 123,
        });

        expect(onEvent).not.toHaveBeenCalled();

        const resultIdentity = { success: true };
        worker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: true,
            result: resultIdentity,
        });

        await expect(requestPromise).resolves.toBe(resultIdentity);
    });

    describe('SQL statement counts', () => {
        const PERF_CAPTURE_ENV = 'IPTVNATOR_PERF_CAPTURE';
        const originalCapture = process.env[PERF_CAPTURE_ENV];

        afterEach(() => {
            if (originalCapture === undefined) {
                delete process.env[PERF_CAPTURE_ENV];
            } else {
                process.env[PERF_CAPTURE_ENV] = originalCapture;
            }
        });

        async function emitCountsDuringRequest(
            counts: unknown[]
        ): Promise<Record<string, number>> {
            const client = createClient();
            const requestPromise = client.request('DB_GET_APP_STATE', {
                key: 'counts',
            });
            const worker = mockWorkerInstances[0];
            worker.emit('message', { type: 'ready' });
            await flushPromises();
            const request = worker.postMessage.mock.calls[0][0];

            for (const count of counts) {
                worker.emit('message', {
                    type: 'performance-sql-statements',
                    count,
                });
            }
            worker.emit('message', {
                type: 'response',
                requestId: request.requestId,
                success: true,
                result: 'state',
            });

            await expect(requestPromise).resolves.toBe('state');
            const { performanceCounters } = await import('./debug-trace');
            return performanceCounters.read().counters;
        }

        it('adds worker statement counts to main.sqlStatements with capture on', async () => {
            process.env[PERF_CAPTURE_ENV] = '1';

            await expect(
                emitCountsDuringRequest([3, 4, 0, -1, 'x'])
            ).resolves.toEqual({ 'main.sqlStatements': 7 });
        });

        it('counts nothing without the capture flag', async () => {
            delete process.env[PERF_CAPTURE_ENV];

            await expect(emitCountsDuringRequest([3])).resolves.toEqual({});
        });
    });

    it('turns serialized worker errors into rejected Error instances', async () => {
        const client = createClient();
        const requestPromise = client.request('DB_DELETE_PLAYLIST', {
            playlistId: 'xtream-1',
        });
        const worker = mockWorkerInstances[0];

        worker.emit('message', { type: 'ready' });
        await flushPromises();

        const request = worker.postMessage.mock.calls[0][0];
        worker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: false,
            error: {
                name: 'SqliteBusyError',
                message: 'database is locked',
                stack: 'stack-trace',
            },
        });

        await expect(requestPromise).rejects.toMatchObject({
            name: 'SqliteBusyError',
            message: 'database is locked',
        });
    });

    it('preserves AbortError responses from the worker', async () => {
        const client = createClient();
        const requestPromise = client.request('DB_SAVE_CONTENT', {
            playlistId: 'xtream-1',
            streams: [],
            type: 'movie',
        });
        const worker = mockWorkerInstances[0];

        worker.emit('message', { type: 'ready' });
        await flushPromises();

        const request = worker.postMessage.mock.calls[0][0];
        worker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: false,
            error: {
                name: 'AbortError',
                message: 'Operation "save-content" was cancelled',
            },
        });

        await expect(requestPromise).rejects.toMatchObject({
            name: 'AbortError',
            message: 'Operation "save-content" was cancelled',
        });
    });

    it('posts cancel messages to the current worker', async () => {
        const client = createClient();
        const requestPromise = client.request('DB_DELETE_PLAYLIST', {
            playlistId: 'xtream-1',
        });
        const worker = mockWorkerInstances[0];

        worker.emit('message', { type: 'ready' });
        await flushPromises();

        await expect(client.cancel('operation-123')).resolves.toEqual({
            success: true,
        });

        expect(worker.postMessage).toHaveBeenCalledWith({
            type: 'cancel',
            operationId: 'operation-123',
        });

        const request = worker.postMessage.mock.calls[0][0];
        worker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: true,
            result: { success: true },
        });

        await expect(requestPromise).resolves.toEqual({ success: true });
    });

    it('rejects pending work on worker exit and starts a fresh worker for the next request', async () => {
        const client = createClient();
        const firstRequest = client.request('DB_SEARCH_CONTENT', {
            playlistId: 'xtream-1',
            searchTerm: 'matrix',
            types: ['movie'],
        });
        const firstWorker = mockWorkerInstances[0];

        firstWorker.emit('message', { type: 'ready' });
        await flushPromises();
        firstWorker.emit('exit', 1);

        await expect(firstRequest).rejects.toThrow(
            'Database worker stopped with exit code 1'
        );

        const secondRequest = client.request('DB_SEARCH_CONTENT', {
            playlistId: 'xtream-1',
            searchTerm: 'neo',
            types: ['movie'],
        });
        const secondWorker = mockWorkerInstances[1];

        secondWorker.emit('message', { type: 'ready' });
        await flushPromises();

        const request = secondWorker.postMessage.mock.calls[0][0];
        secondWorker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: true,
            result: [],
        });

        await expect(secondRequest).resolves.toEqual([]);
    });

    it.each(['exit', 'error'])(
        'ignores a failed worker’s late %s after restarting',
        async (eventName) => {
            const client = createClient();
            const firstRequest = client.request('DB_GLOBAL_SEARCH', {});
            const firstFailure =
                expect(firstRequest).rejects.toThrow('worker failed');
            const firstWorker = mockWorkerInstances[0];
            firstWorker.emit('message', { type: 'ready' });
            await flushPromises();
            firstWorker.emit('error', new Error('worker failed'));
            await firstFailure;

            const secondRequest = client.request('DB_GLOBAL_SEARCH', {});
            const secondResult = expect(secondRequest).resolves.toEqual([]);
            const secondWorker = mockWorkerInstances[1];
            secondWorker.emit('message', { type: 'ready' });
            await flushPromises();

            firstWorker.emit(
                eventName,
                eventName === 'exit' ? 1 : new Error('late error')
            );
            const request = secondWorker.postMessage.mock.calls[0][0];
            secondWorker.emit('message', {
                type: 'response',
                requestId: request.requestId,
                success: true,
                result: [],
            });
            await secondResult;
            await client.cancel('operation-2');
            expect(mockWorkerInstances).toHaveLength(2);
        }
    );

    it('ignores a failed worker’s late ready and response messages', async () => {
        const client = createClient();
        const firstRequest = client.request('DB_GLOBAL_SEARCH', {});
        const firstFailure =
            expect(firstRequest).rejects.toThrow('worker failed');
        const firstWorker = mockWorkerInstances[0];
        firstWorker.emit('error', new Error('worker failed'));
        await firstFailure;

        const secondRequest = client.request('DB_GLOBAL_SEARCH', {});
        const secondResult = expect(secondRequest).resolves.toEqual([]);
        const secondWorker = mockWorkerInstances[1];
        firstWorker.emit('message', { type: 'ready' });
        await flushPromises();
        expect(secondWorker.postMessage).not.toHaveBeenCalled();

        secondWorker.emit('message', { type: 'ready' });
        await flushPromises();
        const request = secondWorker.postMessage.mock.calls[0][0];
        firstWorker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: true,
            result: ['stale'],
        });
        secondWorker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: true,
            result: [],
        });
        await secondResult;
    });

    it('rejects requests waiting for readiness when shut down', async () => {
        const client = createClient();
        const request = client.request('DB_GLOBAL_SEARCH', {});
        const result = expect(request).rejects.toThrow(
            'Database worker shut down'
        );

        await client.shutdown();
        await result;
    });

    it.each(['request', 'cancel', 'parental-lock'] as const)(
        'rejects a ready %s dispatch when its worker is replaced before the continuation',
        async (kind) => {
            const client = createClient();
            const dispatch = () => {
                if (kind === 'cancel') return client.cancel('operation-1');
                if (kind === 'parental-lock')
                    return client.setParentalLockState(true);
                return client.request('DB_GLOBAL_SEARCH', {});
            };
            let outcome: unknown = 'pending';
            void dispatch().then(
                () => (outcome = 'resolved'),
                (error) => (outcome = error)
            );
            const firstWorker = mockWorkerInstances[0];
            firstWorker.emit('message', { type: 'ready' });
            const shutdown = client.shutdown();
            const replacementRequest = client.request('DB_GLOBAL_SEARCH', {});
            const replacementResult = expect(
                replacementRequest
            ).resolves.toEqual([]);
            const secondWorker = mockWorkerInstances[1];

            await flushPromises();
            const outcomeBeforeReplacementReady = outcome;
            const messagesBeforeReplacementReady =
                secondWorker.postMessage.mock.calls.length;

            secondWorker.emit('message', { type: 'ready' });
            await flushPromises();
            for (const [message] of secondWorker.postMessage.mock.calls) {
                if (message.type !== 'request') continue;
                secondWorker.emit('message', {
                    type: 'response',
                    requestId: message.requestId,
                    success: true,
                    result: [],
                });
            }
            await replacementResult;
            await shutdown;

            expect(outcomeBeforeReplacementReady).toEqual(
                new Error('Database worker shut down or replaced')
            );
            expect(firstWorker.postMessage).not.toHaveBeenCalled();
            expect(messagesBeforeReplacementReady).toBe(0);
        }
    );

    it('handles replacement exits while the previous worker is terminating', async () => {
        const client = createClient();
        const firstRequest = client.request('DB_GLOBAL_SEARCH', {});
        const firstWorker = mockWorkerInstances[0];
        firstWorker.emit('message', { type: 'ready' });
        await flushPromises();
        const firstFailure = expect(firstRequest).rejects.toThrow(
            'Database worker shut down'
        );
        let finishTermination!: (code: number) => void;
        firstWorker.terminate.mockImplementation(
            () =>
                new Promise<number>((resolve) => {
                    finishTermination = resolve;
                })
        );
        const shutdown = client.shutdown();
        await firstFailure;

        const secondRequest = client.request('DB_GLOBAL_SEARCH', {});
        const secondFailure = expect(secondRequest).rejects.toThrow(
            'Database worker stopped with exit code 1'
        );
        const secondWorker = mockWorkerInstances[1];
        secondWorker.emit('message', { type: 'ready' });
        await flushPromises();
        firstWorker.emit('exit', 0);
        secondWorker.emit('exit', 1);
        finishTermination(0);

        await shutdown;
        await secondFailure;
    });

    it('rejects requests with actionable worker path errors', async () => {
        const client = createClient();
        resolveWorkerRuntimeBootstrap.mockImplementation(() => {
            const error = new Error(
                'Unable to resolve worker "database.worker.js".\nTried:\n- /missing/database.worker.js'
            );
            error.name = 'WorkerPathResolutionError';
            throw error;
        });

        await expect(
            client.request('DB_GLOBAL_SEARCH', { searchTerm: 'matrix' })
        ).rejects.toMatchObject({
            name: 'WorkerPathResolutionError',
            message: expect.stringContaining('database.worker.js'),
        });
    });
});
