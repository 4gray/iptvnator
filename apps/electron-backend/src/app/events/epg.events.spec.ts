import type EpgEventsType from './epg.events';

const mockWorkerInstances: any[] = [];
const resolveWorkerRuntimeBootstrap = jest.fn();
const getDatabase = jest.fn();

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
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

describe('EpgEvents', () => {
    let EpgEvents: typeof EpgEventsType;
    let EpgWorkerService: typeof import('./epg-worker.service').EpgWorkerService;
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
        ({ EpgWorkerService } = await import('./epg-worker.service'));
    });

    afterEach(() => {
        jest.useRealTimers();
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        getDatabase.mockReset();
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
            options: {},
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

    it('rejects when the EPG clear worker exits before completion', async () => {
        const workerService = new EpgWorkerService('[Test EPG]', 1000);
        const clearPromise = workerService.clearEpgData();
        const worker = mockWorkerInstances[0];

        worker.emit('exit', 0);

        await expect(clearPromise).rejects.toThrow(
            'Clear worker exited unexpectedly (code 0)'
        );
    });

    it('rejects when the EPG clear worker never responds', async () => {
        jest.useFakeTimers();

        const workerService = new EpgWorkerService('[Test EPG]', 25);
        const clearPromise = workerService.clearEpgData();
        const worker = mockWorkerInstances[0];

        worker.emit('message', { type: 'READY' });
        jest.advanceTimersByTime(25);

        await expect(clearPromise).rejects.toThrow('EPG clear timed out after');
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('reuses the in-flight worker when the same EPG URL is fetched concurrently', async () => {
        const workerService = new EpgWorkerService('[Test EPG]', 1000);
        const url = 'https://example.com/guide.xml';

        const firstPromise = workerService.fetchEpgFromUrl(url);
        const secondPromise = workerService.fetchEpgFromUrl(url);

        expect(mockWorkerInstances).toHaveLength(1);

        const worker = mockWorkerInstances[0];
        worker.emit('message', { type: 'READY' });
        await flushPromises();
        worker.emit('message', {
            type: 'EPG_COMPLETE',
            stats: { totalChannels: 1, totalPrograms: 2 },
        });

        await expect(firstPromise).resolves.toBeUndefined();
        await expect(secondPromise).resolves.toBeUndefined();
        expect(mockWorkerInstances).toHaveLength(1);
    });

    it('starts a fresh worker once a failed fetch for the same URL has settled', async () => {
        const workerService = new EpgWorkerService('[Test EPG]', 1000);
        const url = 'https://example.com/guide.xml';

        const firstPromise = workerService.fetchEpgFromUrl(url);
        mockWorkerInstances[0].emit('message', {
            type: 'EPG_ERROR',
            error: 'parse failed',
        });
        await expect(firstPromise).rejects.toThrow('parse failed');

        const secondPromise = workerService.fetchEpgFromUrl(url);
        expect(mockWorkerInstances).toHaveLength(2);

        const retryWorker = mockWorkerInstances[1];
        retryWorker.emit('message', { type: 'READY' });
        await flushPromises();
        retryWorker.emit('message', {
            type: 'EPG_COMPLETE',
            stats: { totalChannels: 1, totalPrograms: 2 },
        });

        await expect(secondPromise).resolves.toBeUndefined();
    });

    it('shares the in-flight promise while a completed fetch is still terminating', async () => {
        const workerService = new EpgWorkerService('[Test EPG]', 1000);
        const url = 'https://example.com/guide.xml';

        const firstPromise = workerService.fetchEpgFromUrl(url);
        const worker = mockWorkerInstances[0];

        let releaseTerminate!: () => void;
        worker.terminate.mockReturnValue(
            new Promise<void>((resolve) => {
                releaseTerminate = resolve;
            })
        );

        worker.emit('message', { type: 'READY' });
        await flushPromises();
        worker.emit('message', {
            type: 'EPG_COMPLETE',
            stats: { totalChannels: 1, totalPrograms: 2 },
        });
        await flushPromises();

        // The URL is already marked as fetched, but the worker is still
        // terminating: a new request must keep awaiting that window instead
        // of resolving early via the fetched-URL shortcut.
        const secondPromise = workerService.fetchEpgFromUrl(url);
        expect(mockWorkerInstances).toHaveLength(1);

        let secondResolved = false;
        void secondPromise.then(() => {
            secondResolved = true;
        });
        await flushPromises();
        expect(secondResolved).toBe(false);

        releaseTerminate();
        await expect(firstPromise).resolves.toBeUndefined();
        await flushPromises();
        expect(secondResolved).toBe(true);
    });

    it('does not resolve clearEpgData until interrupted fetch workers have terminated', async () => {
        const workerService = new EpgWorkerService('[Test EPG]', 1000);

        void workerService
            .fetchEpgFromUrl('https://example.com/guide.xml')
            .catch(() => undefined);
        const fetchWorker = mockWorkerInstances[0];

        let releaseFetchTerminate!: () => void;
        fetchWorker.terminate.mockReturnValue(
            new Promise<void>((resolve) => {
                releaseFetchTerminate = resolve;
            })
        );

        const clearPromise = workerService.clearEpgData();
        const clearWorker = mockWorkerInstances[1];
        clearWorker.emit('message', { type: 'READY' });
        clearWorker.emit('message', { type: 'CLEAR_COMPLETE' });

        let cleared = false;
        void clearPromise.then(() => {
            cleared = true;
        });
        await flushPromises();
        expect(fetchWorker.terminate).toHaveBeenCalled();
        expect(cleared).toBe(false);

        releaseFetchTerminate();
        await flushPromises();
        expect(cleared).toBe(true);
    });

    it('rejects a timed-out fetch with the timeout error after the worker has terminated', async () => {
        jest.useFakeTimers();

        const workerService = new EpgWorkerService('[Test EPG]', 25);
        const fetchPromise = workerService.fetchEpgFromUrl(
            'https://example.com/guide.xml'
        );
        const worker = mockWorkerInstances[0];

        let terminated = false;
        worker.terminate.mockImplementation(() => {
            terminated = true;
            // Worker threads emit 'exit' as part of termination; the timeout
            // rejection must win over the generic exit-handler rejection.
            worker.emit('exit', 1);
            return Promise.resolve(0);
        });

        worker.emit('message', { type: 'READY' });
        jest.advanceTimersByTime(25);

        await expect(fetchPromise).rejects.toThrow('EPG fetch timed out after');
        expect(terminated).toBe(true);
    });

    it('falls back to case-insensitive channel id lookup for EPG programs', async () => {
        const select = jest.fn();
        const programLimitExact = jest.fn().mockResolvedValue([]);
        const channelLimit = jest
            .fn()
            .mockResolvedValue([{ id: 'BBC.ONE.UK', displayName: 'BBC One' }]);
        const programLimitResolved = jest.fn().mockResolvedValue([
            {
                id: 1,
                channelId: 'BBC.ONE.UK',
                start: '2026-04-14T10:00:00Z',
                stop: '2026-04-14T11:00:00Z',
                title: 'News',
                description: null,
                category: null,
                iconUrl: null,
                rating: null,
                episodeNum: null,
            },
        ]);

        const from = jest
            .fn()
            .mockReturnValueOnce({
                where: jest.fn().mockReturnValue({
                    orderBy: jest.fn().mockReturnValue({
                        limit: programLimitExact,
                    }),
                }),
            })
            .mockReturnValueOnce({
                where: jest.fn().mockReturnValue({
                    limit: channelLimit,
                }),
            })
            .mockReturnValueOnce({
                where: jest.fn().mockReturnValue({
                    orderBy: jest.fn().mockReturnValue({
                        limit: programLimitResolved,
                    }),
                }),
            });

        select.mockImplementation(() => ({ from }));

        getDatabase.mockResolvedValue({ select });

        const programs = await (EpgEvents as unknown as Record<string, any>)[
            'handleGetChannelPrograms'
        ]('bbc.one.uk');

        expect(programs).toHaveLength(1);
        expect(programs[0].channel).toBe('BBC.ONE.UK');
    });

    it('resolves channel metadata using exact id, case-insensitive id, and display name fallback', async () => {
        const where = jest.fn().mockResolvedValue([
            {
                id: 'BBC.ONE.UK',
                displayName: 'BBC One',
                iconUrl: 'https://example.com/bbc-one.png',
            },
            {
                id: 'guide-news',
                displayName: 'Guide News',
                iconUrl: 'https://example.com/guide-news.png',
            },
        ]);
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });

        getDatabase.mockResolvedValue({ select });

        const metadata = await (EpgEvents as unknown as Record<string, any>)[
            'handleGetChannelMetadata'
        ](['BBC.ONE.UK', 'bbc.one.uk', 'Guide News', 'Missing Channel']);

        expect(metadata).toEqual({
            'BBC.ONE.UK': {
                id: 'BBC.ONE.UK',
                displayName: 'BBC One',
                iconUrl: 'https://example.com/bbc-one.png',
            },
            'bbc.one.uk': {
                id: 'BBC.ONE.UK',
                displayName: 'BBC One',
                iconUrl: 'https://example.com/bbc-one.png',
            },
            'Guide News': {
                id: 'guide-news',
                displayName: 'Guide News',
                iconUrl: 'https://example.com/guide-news.png',
            },
            'Missing Channel': null,
        });
    });

    it('drops malformed EPG rows with invalid stop dates', async () => {
        const select = jest.fn();
        const from = jest.fn();
        const where = jest.fn();
        const orderBy = jest.fn();
        const limit = jest.fn();

        select.mockImplementation(() => ({ from }));
        from.mockReturnValue({ where });
        where.mockReturnValue({ orderBy });
        orderBy.mockReturnValue({ limit });
        limit.mockResolvedValue([
            {
                id: 1,
                channelId: 'id2e2cd03c90ad',
                start: '2026-04-14T20:00:00+00:00',
                stop: '2026-04-14T21:00:00+00:00',
                title: 'valid',
                description: null,
                category: null,
                iconUrl: null,
                rating: null,
                episodeNum: null,
            },
            {
                id: 2,
                channelId: 'id2e2cd03c90ad',
                start: '2026-04-14T21:00:00+00:00',
                stop: '',
                title: 'invalid',
                description: null,
                category: null,
                iconUrl: null,
                rating: null,
                episodeNum: null,
            },
        ]);

        getDatabase.mockResolvedValue({ select });

        const programs = await (EpgEvents as unknown as Record<string, any>)[
            'handleGetChannelPrograms'
        ]('id2e2cd03c90ad');

        expect(programs).toHaveLength(1);
        expect(programs[0].title).toBe('valid');
    });
});
