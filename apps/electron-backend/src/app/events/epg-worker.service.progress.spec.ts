/**
 * Fetch-timeout and renderer progress-reporting coverage for EpgWorkerService.
 * Worker lifecycle and deduplication live in `epg-worker.service.spec.ts`.
 */
const mockWorkerInstances: any[] = [];
const mockGetAllWindows = jest.fn((): any[] => []);
const mockResolveWorkerRuntimeBootstrap = jest.fn();

jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/mock/app.asar',
    },
    BrowserWindow: {
        getAllWindows: () => mockGetAllWindows(),
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

describe('EpgWorkerService timeout and progress reporting', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    const url = 'https://example.com/guide.xml';

    beforeEach(() => {
        jest.clearAllMocks();
        mockWorkerInstances.length = 0;
        mockGetAllWindows.mockReturnValue([]);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        mockResolveWorkerRuntimeBootstrap.mockReturnValue({
            workerPath: '/mock/workers/epg-parser.worker.js',
            workerPathCandidates: ['/mock/workers/epg-parser.worker.js'],
            nativeModuleSearchPaths: [
                '/mock/resources/app.asar.unpacked/node_modules',
            ],
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    async function flushPromises(): Promise<void> {
        await new Promise((resolve) => setImmediate(resolve));
    }

    function createRendererWindow() {
        return { webContents: { send: jest.fn() } };
    }

    describe('fetch timeout', () => {
        it('rejects when the fetch times out without progress', async () => {
            jest.useFakeTimers();
            const windows = [createRendererWindow()];
            mockGetAllWindows.mockReturnValue(windows);

            const service = new EpgWorkerService('[Test EPG]', 50);
            const fetchPromise = service.fetchEpgFromUrl(url);
            const worker = mockWorkerInstances[0];

            worker.emit('message', { type: 'READY' });
            jest.advanceTimersByTime(50);

            await expect(fetchPromise).rejects.toThrow(
                'EPG fetch timed out after'
            );
            expect(worker.terminate).toHaveBeenCalledTimes(1);
            expect(windows[0].webContents.send).toHaveBeenCalledWith(
                'EPG_PROGRESS_UPDATE',
                expect.objectContaining({
                    url,
                    status: 'error',
                    error: expect.stringContaining('timed out'),
                })
            );
        });

        it('ignores a late worker message after the timeout has settled', async () => {
            jest.useFakeTimers();

            const service = new EpgWorkerService('[Test EPG]', 50);
            const fetchPromise = service.fetchEpgFromUrl(url);
            const worker = mockWorkerInstances[0];

            worker.emit('message', { type: 'READY' });
            jest.advanceTimersByTime(50);
            await expect(fetchPromise).rejects.toThrow(
                'EPG fetch timed out after'
            );

            // A completion racing in after the timeout must not re-settle the
            // promise or terminate the worker a second time.
            worker.emit('message', {
                type: 'EPG_COMPLETE',
                stats: { totalChannels: 1, totalPrograms: 1 },
            });
            expect(worker.terminate).toHaveBeenCalledTimes(1);
            await expect(fetchPromise).rejects.toThrow(
                'EPG fetch timed out after'
            );
        });

        it('reschedules the timeout only when progress moves forward', async () => {
            jest.useFakeTimers();

            const service = new EpgWorkerService('[Test EPG]', 100);
            const fetchPromise = service.fetchEpgFromUrl(url);
            const fetchOutcome = fetchPromise.then(
                () => 'resolved' as const,
                (error: Error) => error.message
            );
            const worker = mockWorkerInstances[0];

            worker.emit('message', { type: 'READY' });

            jest.advanceTimersByTime(60);
            worker.emit('message', {
                type: 'EPG_PROGRESS',
                stats: { totalChannels: 10, totalPrograms: 100 },
            });

            // Moving progress rescheduled the timeout, so 60ms later the
            // fetch is still alive even though 120ms passed overall.
            jest.advanceTimersByTime(60);
            expect(worker.terminate).not.toHaveBeenCalled();

            // Stalled progress (same stats) must not reschedule the timeout.
            worker.emit('message', {
                type: 'EPG_PROGRESS',
                stats: { totalChannels: 10, totalPrograms: 100 },
            });
            jest.advanceTimersByTime(60);

            await expect(fetchOutcome).resolves.toContain('timed out');
            expect(worker.terminate).toHaveBeenCalledTimes(1);
        });
    });

    describe('progress reporting', () => {
        it('broadcasts progress updates to every renderer window', async () => {
            const windows = [createRendererWindow(), createRendererWindow()];
            mockGetAllWindows.mockReturnValue(windows);

            const service = new EpgWorkerService('[Test EPG]', 1000);
            const fetchPromise = service.fetchEpgFromUrl(url);
            const worker = mockWorkerInstances[0];

            worker.emit('message', { type: 'READY' });
            worker.emit('message', {
                type: 'EPG_PROGRESS',
                stats: { totalChannels: 5, totalPrograms: 50 },
            });
            worker.emit('message', {
                type: 'EPG_COMPLETE',
                stats: { totalChannels: 5, totalPrograms: 55 },
            });
            await fetchPromise;

            for (const win of windows) {
                const statuses = win.webContents.send.mock.calls.map(
                    ([channel, payload]: [string, { status: string }]) => {
                        expect(channel).toBe('EPG_PROGRESS_UPDATE');
                        return payload.status;
                    }
                );
                expect(statuses).toEqual(['loading', 'loading', 'complete']);
            }

            expect(windows[0].webContents.send).toHaveBeenCalledWith(
                'EPG_PROGRESS_UPDATE',
                expect.objectContaining({
                    url,
                    status: 'complete',
                    stats: { totalChannels: 5, totalPrograms: 55 },
                })
            );
        });

        it('forwards EPG_ERROR metadata to the renderer and rejects', async () => {
            const windows = [createRendererWindow()];
            mockGetAllWindows.mockReturnValue(windows);

            const service = new EpgWorkerService('[Test EPG]', 1000);
            const fetchPromise = service.fetchEpgFromUrl(url);
            const worker = mockWorkerInstances[0];

            worker.emit('message', { type: 'READY' });
            worker.emit('message', {
                type: 'EPG_ERROR',
                error: 'untrusted host',
                errorCode: 'UNTRUSTED_HOST',
                errorHost: 'example.com',
            });

            await expect(fetchPromise).rejects.toThrow('untrusted host');
            await flushPromises();
            expect(windows[0].webContents.send).toHaveBeenCalledWith(
                'EPG_PROGRESS_UPDATE',
                expect.objectContaining({
                    url,
                    status: 'error',
                    error: 'untrusted host',
                    errorCode: 'UNTRUSTED_HOST',
                    errorHost: 'example.com',
                })
            );
            expect(service.hasFetchedUrl(url)).toBe(false);
        });
    });
});
