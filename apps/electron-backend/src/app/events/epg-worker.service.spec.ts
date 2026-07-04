/**
 * Worker lifecycle and in-flight deduplication coverage for EpgWorkerService.
 * Timeout and renderer progress reporting live in
 * `epg-worker.service.progress.spec.ts`.
 */
const mockWorkerInstances: any[] = [];
const mockResolveWorkerRuntimeBootstrap = jest.fn();

jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/mock/app.asar',
    },
    BrowserWindow: {
        getAllWindows: () => [],
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
        mockResolveWorkerRuntimeBootstrap(...args),
}));

import { EpgWorkerService } from './epg-worker.service';

describe('EpgWorkerService worker lifecycle', () => {
    let service: EpgWorkerService;
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    const url = 'https://example.com/guide.xml';

    beforeEach(() => {
        jest.clearAllMocks();
        mockWorkerInstances.length = 0;
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        mockResolveWorkerRuntimeBootstrap.mockReturnValue({
            workerPath: '/mock/workers/epg-parser.worker.js',
            workerPathCandidates: ['/mock/workers/epg-parser.worker.js'],
            nativeModuleSearchPaths: [
                '/mock/resources/app.asar.unpacked/node_modules',
            ],
        });
        service = new EpgWorkerService('[Test EPG]', 1000);
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('worker lifecycle', () => {
        it('spawns the worker with bootstrap paths and drives the FETCH_EPG flow', async () => {
            const options = { manuallyTrustedHosts: ['example.com'] } as any;
            const fetchPromise = service.fetchEpgFromUrl(url, options);
            const worker = mockWorkerInstances[0];
            const { Worker } = jest.requireMock('worker_threads');

            expect(mockResolveWorkerRuntimeBootstrap).toHaveBeenCalledWith(
                expect.objectContaining({
                    isPackaged: false,
                    workerFilename: 'epg-parser.worker.js',
                    appPath: '/mock/app.asar',
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
            expect(worker.postMessage).toHaveBeenCalledWith({
                type: 'FETCH_EPG',
                url,
                options,
            });

            worker.emit('message', {
                type: 'EPG_COMPLETE',
                stats: { totalChannels: 3, totalPrograms: 42 },
            });

            await expect(fetchPromise).resolves.toBeUndefined();
            expect(worker.terminate).toHaveBeenCalledTimes(1);
            expect(service.hasFetchedUrl(url)).toBe(true);
        });

        it('rejects when the worker emits an error event', async () => {
            const fetchPromise = service.fetchEpgFromUrl(url);
            const worker = mockWorkerInstances[0];

            worker.emit('error', new Error('worker crashed'));

            await expect(fetchPromise).rejects.toThrow('worker crashed');
            expect(worker.terminate).toHaveBeenCalledTimes(1);
            expect(service.hasFetchedUrl(url)).toBe(false);
        });

        it('rejects when the worker exits before settling', async () => {
            const fetchPromise = service.fetchEpgFromUrl(url);
            const worker = mockWorkerInstances[0];

            worker.emit('exit', 7);

            await expect(fetchPromise).rejects.toThrow(
                'Worker exited unexpectedly (code 7)'
            );
        });

        it('rejects and clears the in-flight entry when worker construction fails', async () => {
            const { Worker } = jest.requireMock('worker_threads');
            Worker.mockImplementationOnce(() => {
                throw new Error('cannot spawn worker');
            });

            await expect(service.fetchEpgFromUrl(url)).rejects.toThrow(
                'cannot spawn worker'
            );

            // The failed fetch must not poison future fetches for the URL.
            const retryPromise = service.fetchEpgFromUrl(url);
            expect(mockWorkerInstances).toHaveLength(1);

            const worker = mockWorkerInstances[0];
            worker.emit('message', { type: 'READY' });
            worker.emit('message', {
                type: 'EPG_COMPLETE',
                stats: { totalChannels: 1, totalPrograms: 1 },
            });
            await expect(retryPromise).resolves.toBeUndefined();
        });
    });

    describe('in-flight deduplication', () => {
        it('shares one worker between concurrent fetches of the same URL', async () => {
            const firstPromise = service.fetchEpgFromUrl(url);
            const secondPromise = service.fetchEpgFromUrl(url);

            expect(mockWorkerInstances).toHaveLength(1);

            const worker = mockWorkerInstances[0];
            worker.emit('message', { type: 'READY' });
            worker.emit('message', {
                type: 'EPG_COMPLETE',
                stats: { totalChannels: 1, totalPrograms: 1 },
            });

            await expect(firstPromise).resolves.toBeUndefined();
            await expect(secondPromise).resolves.toBeUndefined();
            expect(mockWorkerInstances).toHaveLength(1);
        });

        it('spawns separate workers for different URLs fetched concurrently', async () => {
            const otherUrl = 'https://example.org/other-guide.xml';
            const firstPromise = service.fetchEpgFromUrl(url);
            const secondPromise = service.fetchEpgFromUrl(otherUrl);

            expect(mockWorkerInstances).toHaveLength(2);

            for (const worker of mockWorkerInstances) {
                worker.emit('message', { type: 'READY' });
                worker.emit('message', {
                    type: 'EPG_COMPLETE',
                    stats: { totalChannels: 1, totalPrograms: 1 },
                });
            }

            await expect(firstPromise).resolves.toBeUndefined();
            await expect(secondPromise).resolves.toBeUndefined();
        });

        it('skips already fetched URLs until they are invalidated', async () => {
            const firstPromise = service.fetchEpgFromUrl(url);
            const worker = mockWorkerInstances[0];
            worker.emit('message', { type: 'READY' });
            worker.emit('message', {
                type: 'EPG_COMPLETE',
                stats: { totalChannels: 1, totalPrograms: 1 },
            });
            await firstPromise;

            await expect(service.fetchEpgFromUrl(url)).resolves.toBeUndefined();
            expect(mockWorkerInstances).toHaveLength(1);

            service.deleteFetchedUrl(url);
            const refetchPromise = service.fetchEpgFromUrl(url);
            expect(mockWorkerInstances).toHaveLength(2);

            // Settle the refetch so no timeout leaks past the test.
            mockWorkerInstances[1].emit('exit', 0);
            await expect(refetchPromise).rejects.toThrow(
                'Worker exited unexpectedly'
            );
        });
    });
});
