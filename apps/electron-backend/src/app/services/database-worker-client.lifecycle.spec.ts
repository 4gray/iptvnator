import type { DatabaseWorkerClient as DatabaseWorkerClientType } from './database-worker-client';

const mockWorkerInstances: any[] = [];
const resolveWorkerRuntimeBootstrap = jest.fn();

jest.mock('electron', () => ({
    app: { isPackaged: false, getAppPath: () => '/mock/app.asar' },
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

describe('DatabaseWorkerClient lifecycle', () => {
    let DatabaseWorkerClient: typeof DatabaseWorkerClientType;
    let clients: DatabaseWorkerClientType[];

    beforeEach(async () => {
        jest.resetModules();
        mockWorkerInstances.length = 0;
        resolveWorkerRuntimeBootstrap.mockReset();
        resolveWorkerRuntimeBootstrap.mockReturnValue({
            workerPath: '/mock/workers/database.worker.js',
            workerPathCandidates: ['/mock/workers/database.worker.js'],
            nativeModuleSearchPaths: [],
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
        const client = new DatabaseWorkerClient(
            jest.fn().mockResolvedValue(undefined)
        );
        clients.push(client);
        return client;
    }

    async function flushPromises(): Promise<void> {
        await new Promise((resolve) => setImmediate(resolve));
    }

    it('starts a fresh worker after an unexpected worker exit', async () => {
        const client = createClient();
        const firstRequest = client.request('DB_SEARCH_CONTENT', {
            playlistId: 'xtream-1',
            searchTerm: 'matrix',
            types: ['movie'],
        });
        await flushPromises();
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
        await flushPromises();
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

    it('ignores a stale exit after an errored worker was replaced', async () => {
        const client = createClient();
        const firstRequest = client.request('DB_GLOBAL_SEARCH', {
            searchTerm: 'matrix',
        });
        await flushPromises();
        const firstWorker = mockWorkerInstances[0];
        firstWorker.emit('message', { type: 'ready' });
        await flushPromises();
        firstWorker.emit('error', new Error('Worker crashed'));
        await expect(firstRequest).rejects.toThrow('Worker crashed');

        const secondRequest = client.request('DB_GLOBAL_SEARCH', {
            searchTerm: 'neo',
        });
        await flushPromises();
        const secondWorker = mockWorkerInstances[1];
        secondWorker.emit('message', { type: 'ready' });
        await flushPromises();
        const request = secondWorker.postMessage.mock.calls[0][0];

        firstWorker.emit('exit', 1);
        secondWorker.emit('message', {
            type: 'response',
            requestId: request.requestId,
            success: true,
            result: ['neo'],
        });

        await expect(secondRequest).resolves.toEqual(['neo']);
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

    it('stays closed after shutdown and never creates another worker', async () => {
        const client = createClient();
        const firstRequest = client.request('DB_GLOBAL_SEARCH', {
            searchTerm: 'matrix',
        });
        await flushPromises();
        mockWorkerInstances[0].emit('message', { type: 'ready' });
        await flushPromises();

        const rejectedRequest = expect(firstRequest).rejects.toThrow(
            'Database worker shut down'
        );
        await client.shutdown();
        await rejectedRequest;
        await expect(
            client.request('DB_GLOBAL_SEARCH', { searchTerm: 'neo' })
        ).rejects.toThrow('Database worker shut down');
        await expect(client.cancel('operation-123')).rejects.toThrow(
            'Database worker shut down'
        );
        expect(mockWorkerInstances).toHaveLength(1);
    });
});
