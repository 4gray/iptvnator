import type EpgEventsType from './epg.events';

const mockWorkerInstances: any[] = [];
const resolveWorkerRuntimeBootstrap = jest.fn();

jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/mock/app.asar',
    },
    BrowserWindow: {
        getAllWindows: () => [],
    },
    ipcMain: {
        handle: jest.fn(),
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

jest.mock('../database/connection', () => ({
    getDatabase: jest.fn(),
}));

describe('EpgEvents', () => {
    let EpgEvents: typeof EpgEventsType;
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(async () => {
        jest.resetModules();
        mockWorkerInstances.length = 0;
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        resolveWorkerRuntimeBootstrap.mockReset();
        resolveWorkerRuntimeBootstrap.mockReturnValue({
            workerPath: '/mock/workers/epg-parser.worker.js',
            workerPathCandidates: ['/mock/workers/epg-parser.worker.js'],
            nativeModuleSearchPaths: [
                '/mock/resources/app.asar.unpacked/node_modules',
            ],
        });

        ({ default: EpgEvents } = await import('./epg.events'));
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    async function flushPromises(): Promise<void> {
        await new Promise((resolve) => setImmediate(resolve));
    }

    it('uses the shared worker bootstrap and passes native module search paths to the EPG worker', async () => {
        const fetchPromise = (EpgEvents as unknown as Record<string, any>)[
            'fetchEpgFromUrl'
        ]('https://example.com/guide.xml');
        const worker = mockWorkerInstances[0];
        const { Worker } = jest.requireMock('worker_threads');

        expect(resolveWorkerRuntimeBootstrap).toHaveBeenCalledWith(
            expect.objectContaining({
                workerFilename: 'epg-parser.worker.js',
                developmentWorkerDir: expect.stringContaining('workers'),
            })
        );
        expect(Worker).toHaveBeenCalledWith(expect.any(URL), {
            resourceLimits: {
                maxOldGenerationSizeMb: 4096,
                maxYoungGenerationSizeMb: 512,
            },
            workerData: {
                nativeModuleSearchPaths: [
                    '/mock/resources/app.asar.unpacked/node_modules',
                ],
            },
        });

        worker.emit('message', { type: 'READY' });
        await flushPromises();

        expect(worker.postMessage).toHaveBeenCalledWith({
            type: 'FETCH_EPG',
            url: 'https://example.com/guide.xml',
        });

        worker.emit('message', {
            type: 'EPG_COMPLETE',
            stats: { totalChannels: 1, totalPrograms: 2 },
        });

        await expect(fetchPromise).resolves.toBeUndefined();
    });

    it('rejects with actionable worker path errors', async () => {
        resolveWorkerRuntimeBootstrap.mockImplementation(() => {
            const error = new Error(
                'Unable to resolve worker "epg-parser.worker.js".\nTried:\n- /missing/epg-parser.worker.js'
            );
            error.name = 'WorkerPathResolutionError';
            throw error;
        });

        await expect(EpgEvents.clearEpgData()).rejects.toMatchObject({
            name: 'WorkerPathResolutionError',
            message: expect.stringContaining('epg-parser.worker.js'),
        });
    });
});
