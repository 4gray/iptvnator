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
