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

jest.mock('../services/store.service', () => ({
    TRUSTED_LOCAL_EPG_SOURCES: 'TRUSTED_LOCAL_EPG_SOURCES',
    store: { get: jest.fn(), set: jest.fn() },
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

    it.each(['missing', 'stale', 'fresh'])(
        'uses source-owned freshness for %s metadata',
        async (state) => {
            const { epgChannelSources } = await import('../database/schema');
            const { checkEpgFreshness } = await import('./epg-fetch.service');
            const fresh = [{ updatedAt: new Date().toISOString() }];
            const snapshots =
                state === 'missing'
                    ? []
                    : state === 'fresh'
                      ? fresh
                      : [{ updatedAt: '2000-01-01T00:00:00Z' }];
            getDatabase.mockResolvedValue({
                select: () => ({
                    from: (table: unknown) => ({
                        where: () => ({
                            limit: async () =>
                                table === epgChannelSources ? snapshots : fresh,
                        }),
                    }),
                }),
            });
            const result = await checkEpgFreshness(['shared-source'], 12);
            expect(result).toEqual(
                state === 'fresh'
                    ? { freshUrls: ['shared-source'], staleUrls: [] }
                    : { freshUrls: [], staleUrls: ['shared-source'] }
            );
        }
    );

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
        await flushPromises();
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
        await jest.advanceTimersByTimeAsync(0);
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

    it('stops import writers before clearing and retires the remaining batch', async () => {
        getDatabase.mockRejectedValue(new Error('missing metadata'));
        const { handleFetchEpg } = await import('./epg-fetch.service');
        const { epgWorkerService: service } =
            await import('./epg-worker.service');
        const fetch = handleFetchEpg([
            'https://first/epg',
            'https://queued/epg',
        ]);
        await flushPromises();
        const writer = mockWorkerInstances[0];
        let finishTermination!: () => void;
        writer.terminate.mockReturnValue(
            new Promise<void>((resolve) => {
                finishTermination = () => {
                    writer.emit('exit', 1);
                    resolve();
                };
            })
        );
        const clear = service.clearEpgData();
        await flushPromises();
        const workersBeforeExit = mockWorkerInstances.length;
        const stopRequested = writer.terminate.mock.calls.length;
        finishTermination();
        await flushPromises();
        const clearWorker = mockWorkerInstances[1];
        clearWorker.emit('message', { type: 'READY' });
        clearWorker.emit('message', { type: 'CLEAR_COMPLETE' });
        await clear;
        await flushPromises();
        for (const extra of mockWorkerInstances.slice(2))
            extra.emit('message', { type: 'EPG_COMPLETE' });
        await fetch;
        expect(stopRequested).toBe(1);
        expect(workersBeforeExit).toBe(1);
        expect(mockWorkerInstances).toHaveLength(2);
        expect(clearWorker.postMessage).toHaveBeenCalledWith({
            type: 'CLEAR_EPG',
        });
    });

    it.each(['EPG_CLEAR_ALL', 'EPG_CLEAR_SOURCE'])(
        '%s rejects a completed worker shutdown failure and recovers after retry',
        async (channel) => {
            const { ipcMain } = await import('electron');
            EpgEvents.bootstrapEpgEvents();
            const registrations = [
                ...(ipcMain.handle as jest.Mock).mock.calls,
            ].reverse();
            const clearHandler = registrations.find(
                ([name]) => name === channel
            )?.[1];
            const fetchHandler = registrations.find(
                ([name]) => name === 'EPG_FORCE_FETCH'
            )?.[1];
            if (!clearHandler || !fetchHandler)
                throw new Error('Missing EPG IPC handlers');
            const sourceUrl = 'https://clear-shutdown.example/epg';
            const clear = () => clearHandler({}, { sourceUrl });
            const fetch = () => fetchHandler({}, { url: sourceUrl });
            let settled = false;
            const first = clear().then(
                (result: unknown) => {
                    settled = true;
                    return result;
                },
                (error: Error) => {
                    settled = true;
                    return error;
                }
            );
            await flushPromises();
            const worker = mockWorkerInstances[0];
            const failure = new Error('clear worker still running');
            let rejectStop!: (error: Error) => void;
            worker.terminate.mockRejectedValue(failure).mockImplementationOnce(
                () =>
                    new Promise<void>((_resolve, reject) => {
                        rejectStop = reject;
                    })
            );
            worker.emit('message', { type: 'READY' });
            worker.emit('message', { type: 'CLEAR_COMPLETE' });
            await flushPromises();
            expect(settled).toBe(false);
            rejectStop(failure);
            const firstResult = await first;
            // Failure remains tracked: neither import nor another clear may
            // create a writer while the original clear worker cannot stop.
            const blockedFetch = await fetch();
            const blockedClear = await clear().catch((error: Error) => error);
            const beforeRecovery = mockWorkerInstances.length;
            worker.terminate.mockResolvedValue(0);
            let recovered = false;
            const retry = clear().then((result: unknown) => {
                recovered = true;
                return result;
            });
            await flushPromises();
            const replacement = mockWorkerInstances[1];
            let finishStop!: () => void;
            replacement.terminate.mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        finishStop = resolve;
                    })
            );
            replacement.emit('message', { type: 'READY' });
            replacement.emit('message', { type: 'CLEAR_COMPLETE' });
            await flushPromises();
            expect(recovered).toBe(false);
            finishStop();
            expect(await retry).toEqual({ success: true });
            const afterRecovery = fetch();
            await flushPromises();
            mockWorkerInstances[2].emit('message', { type: 'EPG_COMPLETE' });
            expect(await afterRecovery).toMatchObject({ success: true });
            expect(firstResult).toBe(failure);
            expect(blockedFetch).toMatchObject({
                success: false,
                message: failure.message,
            });
            expect(blockedClear).toBe(failure);
            expect(beforeRecovery).toBe(1);
            expect(worker.terminate).toHaveBeenCalledTimes(4);
            expect(mockWorkerInstances).toHaveLength(3);
        }
    );

    it('force refresh bypasses persisted freshness and session cache with trust options', async () => {
        const { ipcMain } = await import('electron');
        const { epgWorkerService: service } =
            await import('./epg-worker.service');
        const url = 'https://fresh.example/epg';
        getDatabase.mockResolvedValue({
            select: () => ({
                from: () => ({
                    where: () => ({
                        limit: async () => [
                            { updatedAt: new Date().toISOString() },
                        ],
                    }),
                }),
            }),
        });
        service.markFetchedUrl(url);
        EpgEvents.bootstrapEpgEvents();
        const registration = [...(ipcMain.handle as jest.Mock).mock.calls]
            .reverse()
            .find(([name]) => name === 'EPG_FORCE_FETCH');
        if (!registration) throw new Error('Missing force refresh IPC handler');
        const handler = registration[1];
        const options = { trustedInsecureTlsHosts: ['fresh.example'] };
        const request = handler({}, { url: ` ${url} `, options });
        await flushPromises();
        const worker = mockWorkerInstances[0];
        if (worker) {
            worker.emit('message', { type: 'READY' });
            worker.emit('message', { type: 'EPG_COMPLETE' });
        }
        await request;
        expect(mockWorkerInstances).toHaveLength(1);
        expect(worker.postMessage).toHaveBeenCalledWith({
            type: 'FETCH_EPG',
            url,
            options,
        });
    });

    it('serializes separate forced IPC requests with a normal batch', async () => {
        const { ipcMain } = await import('electron');
        const { handleFetchEpg } = await import('./epg-fetch.service');
        getDatabase.mockResolvedValue({
            select: () => ({
                from: () => ({ where: () => ({ limit: async () => [] }) }),
            }),
        });
        EpgEvents.bootstrapEpgEvents();
        const handler = [...(ipcMain.handle as jest.Mock).mock.calls]
            .reverse()
            .find(([name]) => name === 'EPG_FORCE_FETCH')?.[1];
        if (!handler) throw new Error('Missing force refresh IPC handler');
        const first = handler({}, { url: 'https://first/epg' });
        const second = handler({}, { url: 'https://second/epg' });
        const normal = handleFetchEpg([
            'https://normal/one',
            'https://normal/two',
        ]);
        await flushPromises();
        const beforeCompletion = mockWorkerInstances.length;
        // Complete one writer at a time; newly admitted workers are observable
        // only after the prior writer's promise/termination have settled.
        for (let index = 0; index < 4; index++) {
            const worker = mockWorkerInstances[index];
            if (!worker) throw new Error('Expected queued import to start');
            worker.emit('message', { type: 'READY' });
            worker.emit('message', { type: 'EPG_COMPLETE' });
            await flushPromises();
        }
        await Promise.all([first, second, normal]);
        expect(beforeCompletion).toBe(1);
        expect(
            mockWorkerInstances.map(
                (worker) => worker.postMessage.mock.calls[0][0].url
            )
        ).toEqual([
            'https://first/epg',
            'https://second/epg',
            'https://normal/one',
            'https://normal/two',
        ]);
    });

    it.each([
        ['exit', 1],
        ['error', new Error('terminated worker')],
    ] as const)(
        'cancels a retired source on %s without reviving it from late READY or COMPLETE messages',
        async (event, payload) => {
            const service = new EpgWorkerService('[Test EPG]', 1000);
            const url = 'https://removed.example/guide.xml';
            const progress = jest.spyOn(service, 'sendProgressToRenderer');
            const fetch = service.fetchEpgFromUrl(url).then(
                () => true,
                () => false
            );
            const worker = mockWorkerInstances[0];
            let finishTermination!: () => void;
            worker.terminate.mockReturnValue(
                new Promise<void>((resolve) => {
                    finishTermination = resolve;
                })
            );
            const clear = service.clearEpgDataForSource(url);
            worker.emit('message', { type: 'READY' });
            worker.emit('message', { type: 'EPG_COMPLETE' });
            expect(worker.postMessage).not.toHaveBeenCalled();
            expect(service.hasFetchedUrl(url)).toBe(false);
            expect(mockWorkerInstances).toHaveLength(1);
            worker.emit(event, payload);
            finishTermination();
            await flushPromises();
            const clearWorker = mockWorkerInstances[1];
            clearWorker.emit('message', { type: 'READY' });
            clearWorker.emit('message', { type: 'CLEAR_COMPLETE' });
            await clear;
            expect(await fetch).toBe(true);
            expect(progress.mock.calls.map((call) => call[1])).toEqual([
                'cancelled',
            ]);
        }
    );

    it('does not start a queued source removed while an earlier source imports', async () => {
        getDatabase.mockRejectedValue(new Error('force stale for test'));
        const { handleFetchEpg } = await import('./epg-fetch.service');
        const { retireEpgSource } = await import('./epg-source-generation');
        const { epgWorkerService } = await import('./epg-worker.service');
        const progress = jest.spyOn(epgWorkerService, 'sendProgressToRenderer');
        let finishFirst!: () => void;
        const fetch = jest
            .spyOn(epgWorkerService, 'fetchEpgFromUrl')
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        finishFirst = resolve;
                    })
            )
            .mockResolvedValue(undefined);
        const request = handleFetchEpg([
            'https://first.example/guide.xml',
            'https://queued.example/guide.xml',
        ]);
        await flushPromises();
        retireEpgSource('https://queued.example/guide.xml');
        finishFirst();
        await request;
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(progress).toHaveBeenCalledWith(
            'https://queued.example/guide.xml',
            'cancelled',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            expect.any(Number)
        );
        progress.mockRestore();
        fetch.mockRestore();
    });

    it.each([true, false])(
        'awaits a failing worker termination before source cleanup (already retired: %s)',
        async (alreadyRetired) => {
            const service = new EpgWorkerService('[Test EPG]', 1000);
            const url = `https://terminating-${alreadyRetired}.example/guide.xml`;
            const fetch = service.fetchEpgFromUrl(url).catch(() => undefined);
            const worker = mockWorkerInstances[0];
            let finishTermination!: () => void;
            worker.terminate.mockReturnValue(
                new Promise<void>((resolve) => {
                    finishTermination = resolve;
                })
            );
            if (alreadyRetired) {
                const { retireEpgSource } =
                    await import('./epg-source-generation');
                retireEpgSource(url);
            }
            worker.emit(
                'error',
                new Error('worker failed while another source clears')
            );
            const clear = service.clearEpgDataForSource(url);
            const workersBeforeTermination = mockWorkerInstances.length;
            finishTermination();
            await fetch;
            await flushPromises();
            const clearWorker = mockWorkerInstances[1];
            clearWorker.emit('message', { type: 'READY' });
            clearWorker.emit('message', { type: 'CLEAR_COMPLETE' });
            await clear;
            expect(workersBeforeTermination).toBe(1);
        }
    );

    it('clears one EPG source through a worker and allows it to be fetched again', async () => {
        const workerService = new EpgWorkerService('[Test EPG]', 1000);
        const sourceUrl = 'https://playlist.example.com/guide.xml';
        workerService.markFetchedUrl(sourceUrl);

        const clearPromise = workerService.clearEpgDataForSource(
            ` ${sourceUrl} `
        );
        const worker = mockWorkerInstances[0];

        worker.emit('message', { type: 'READY' });
        await flushPromises();

        expect(worker.postMessage).toHaveBeenCalledWith({
            type: 'CLEAR_EPG_SOURCE',
            sourceUrl,
        });

        worker.emit('message', { type: 'CLEAR_COMPLETE' });

        await expect(clearPromise).resolves.toBeUndefined();
        expect(workerService.hasFetchedUrl(sourceUrl)).toBe(false);
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

    it('waits for source cleanup before starting a replacement import of the same normalized URL', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const url = 'https://replacement.example/guide.xml';
        const clear = service.clearEpgDataForSource(url);
        const clearWorker = mockWorkerInstances[0];
        const replacement = service.fetchEpgFromUrl(` ${url} `);
        const workersBeforeCleanup = mockWorkerInstances.length;
        clearWorker.emit('message', { type: 'READY' });
        clearWorker.emit('message', { type: 'CLEAR_COMPLETE' });
        await clear;
        await flushPromises();
        const fetchWorker = mockWorkerInstances[1];
        fetchWorker.emit('message', { type: 'READY' });
        fetchWorker.emit('message', { type: 'EPG_COMPLETE' });
        await replacement;
        expect(workersBeforeCleanup).toBe(1);
        expect(service.hasFetchedUrl(url)).toBe(true);
    });

    it('serializes repeated clears and retires a replacement waiting for the earlier clear', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const url = 'https://twice-removed.example/guide.xml';
        const firstClear = service.clearEpgDataForSource(url);
        const waitingFetch = service.fetchEpgFromUrl(url);
        const secondClear = service.clearEpgDataForSource(url);
        expect(mockWorkerInstances).toHaveLength(1);
        mockWorkerInstances[0].emit('message', { type: 'CLEAR_COMPLETE' });
        await firstClear;
        await waitingFetch;
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(2);
        mockWorkerInstances[1].emit('message', { type: 'READY' });
        expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledWith({
            type: 'CLEAR_EPG_SOURCE',
            sourceUrl: url,
        });
        mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
        await secondClear;
        expect(service.hasFetchedUrl(url)).toBe(false);
    });

    it('allows a replacement import after a failed source cleanup has terminated', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const url = 'https://retry-clear.example/guide.xml';
        const clear = service.clearEpgDataForSource(url);
        const outcome = clear.catch((error: Error) => error.message);
        const replacement = service.fetchEpgFromUrl(url);
        mockWorkerInstances[0].emit('message', {
            type: 'EPG_ERROR',
            error: 'clear failed',
        });
        expect(await outcome).toBe('clear failed');
        await flushPromises();
        expect(mockWorkerInstances[0].terminate).toHaveBeenCalled();
        mockWorkerInstances[1].emit('message', { type: 'READY' });
        mockWorkerInstances[1].emit('message', { type: 'EPG_COMPLETE' });
        await replacement;
        expect(service.hasFetchedUrl(url)).toBe(true);
    });

    it('keeps an active EPG fetch alive when worker progress keeps moving', async () => {
        jest.useFakeTimers();

        const workerService = new EpgWorkerService('[Test EPG]', 25);
        const fetchPromise = workerService.fetchEpgFromUrl(
            'https://example.com/large-guide.xml'
        );
        const fetchOutcome = fetchPromise.then(
            () => 'resolved' as const,
            (error) => error
        );
        const worker = mockWorkerInstances[0];

        worker.emit('message', { type: 'READY' });

        jest.advanceTimersByTime(20);
        worker.emit('message', {
            type: 'EPG_PROGRESS',
            stats: { totalChannels: 100, totalPrograms: 500000 },
        });

        jest.advanceTimersByTime(20);

        expect(worker.terminate).not.toHaveBeenCalled();

        worker.emit('message', {
            type: 'EPG_COMPLETE',
            stats: { totalChannels: 100, totalPrograms: 510000 },
        });

        await expect(fetchOutcome).resolves.toBe('resolved');
    });

    it('falls back to case-insensitive channel id lookup for EPG programs', async () => {
        const select = jest.fn();

        /**
         * Build a flexible query-chain mock that every db.select().from().<method>() call
         * resolves to the same chain object. Each method (where, orderBy, limit) returns
         * the chain itself, and limit() additionally resolves to the given data. This
         * handles any query shape our service uses (with or without orderBy) without
         * requiring exact call-count ordering — important because our mapping feature
         * inserts extra queries that the original test didn't anticipate.
         */
        function queryChain<T>(data: T) {
            const chain: Record<string, jest.Mock> = {} as Record<
                string,
                jest.Mock
            >;
            chain.where = jest.fn().mockReturnValue(chain);
            chain.innerJoin = jest.fn().mockReturnValue(chain);
            chain.groupBy = jest.fn().mockReturnValue(chain);
            chain.orderBy = jest.fn().mockReturnValue(chain);
            chain.limit = jest.fn().mockResolvedValue(data);
            return chain;
        }

        // getMapping queries (must come first — they return empty)
        const from = jest
            .fn()
            .mockReturnValueOnce(queryChain([])) // 1. getMapping: epgChannelMappings
            .mockReturnValueOnce(queryChain([])) // 2. getMapping: content table
            // Test expectations below
            .mockReturnValueOnce(queryChain([])) // 3. selectChannelPrograms (bbc.one.uk → empty)
            .mockReturnValueOnce(
                queryChain([{ id: 'BBC.ONE.UK', displayName: 'BBC One' }])
            ) // 4. selectChannelById → channel found
            .mockReturnValueOnce(
                queryChain([
                    // 5. selectChannelPrograms (BBC.ONE.UK → programs)
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
                ])
            );

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
        const groupBy = jest.fn();
        const orderBy = jest.fn();
        const limit = jest.fn();

        select.mockImplementation(() => ({ from }));
        from.mockReturnValue({ where });
        where.mockReturnValue({ groupBy });
        groupBy.mockReturnValue({ orderBy });
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
    it('clears without waiting for a local permission prompt and ignores its late approval', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        let approve!: (allowed: boolean) => void;
        const ensureAllowed = jest
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        approve = resolve;
                    })
            )
            .mockResolvedValue(true);
        service.localSourceAuthorizer = { ensureAllowed, authorize: jest.fn() };
        const url = '/tmp/guide.xml';
        const oldFetch = service.fetchEpgFromUrl(url);
        const clear = service.clearEpgData();
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(1);
        mockWorkerInstances[0].emit('message', { type: 'CLEAR_COMPLETE' });
        await clear;
        const replacement = service.fetchEpgFromUrl(url);
        await flushPromises();
        approve(true);
        await oldFetch;
        const duplicate = service.fetchEpgFromUrl(url);
        expect(mockWorkerInstances).toHaveLength(2);
        mockWorkerInstances[1].emit('message', { type: 'EPG_COMPLETE' });
        await Promise.all([replacement, duplicate]);
        expect(ensureAllowed).toHaveBeenCalledTimes(2);
    });

    it('retires requests waiting on an overlapping clear and allows a newer request afterwards', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const first = service.clearEpgData();
        const cancelled = service.fetchEpgFromUrl('https://cancelled/epg');
        const second = service.clearEpgData();
        const replacement = service.fetchEpgFromUrl('https://replacement/epg');
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(1);
        mockWorkerInstances[0].emit('message', { type: 'CLEAR_COMPLETE' });
        await Promise.all([first, second, cancelled]);
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(2);
        mockWorkerInstances[1].emit('message', { type: 'READY' });
        expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ url: 'https://replacement/epg' })
        );
        mockWorkerInstances[1].emit('message', { type: 'EPG_COMPLETE' });
        await replacement;
    });

    it('orders global clear between earlier and later source clears', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const earlier = service.clearEpgDataForSource('https://earlier/epg');
        const global = service.clearEpgData();
        const later = service.clearEpgDataForSource('https://later/epg');
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(1);
        mockWorkerInstances[0].emit('message', { type: 'CLEAR_COMPLETE' });
        await earlier;
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(2);
        mockWorkerInstances[1].emit('message', { type: 'READY' });
        expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledWith({
            type: 'CLEAR_EPG',
        });
        mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
        await global;
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(3);
        mockWorkerInstances[2].emit('message', { type: 'READY' });
        expect(mockWorkerInstances[2].postMessage).toHaveBeenCalledWith({
            type: 'CLEAR_EPG_SOURCE',
            sourceUrl: 'https://later/epg',
        });
        mockWorkerInstances[2].emit('message', { type: 'CLEAR_COMPLETE' });
        await later;
    });

    it('does not delete data when a writer cannot stop and retries the shutdown on the next clear', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const fetch = service.fetchEpgFromUrl('https://unstoppable/epg');
        const writer = mockWorkerInstances[0];
        writer.terminate.mockRejectedValueOnce(new Error('shutdown failed'));
        await expect(service.clearEpgData()).rejects.toThrow('shutdown failed');
        expect(mockWorkerInstances).toHaveLength(1);
        writer.terminate.mockImplementationOnce(async () => {
            writer.emit('exit', 1);
            return 0;
        });
        const retry = service.clearEpgData();
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(2);
        mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
        await Promise.all([retry, fetch]);
    });

    it('awaits a previously failed fetch shutdown before starting global clear', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const fetch = service
            .fetchEpgFromUrl('https://failing/epg')
            .catch(() => undefined);
        const writer = mockWorkerInstances[0];
        let finish!: () => void;
        writer.terminate.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve;
            })
        );
        writer.emit('error', new Error('network failed'));
        const clear = service.clearEpgData();
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(1);
        finish();
        await fetch;
        await flushPromises();
        mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
        await clear;
    });

    it('preserves normal freshness skipping but deduplicates concurrent forced refreshes', async () => {
        const { handleFetchEpg } = await import('./epg-fetch.service');
        const url = 'https://fresh/epg';
        getDatabase.mockResolvedValue({
            select: () => ({
                from: () => ({
                    where: () => ({
                        limit: async () => [
                            { updatedAt: new Date().toISOString() },
                        ],
                    }),
                }),
            }),
        });
        expect(await handleFetchEpg([url])).toMatchObject({ skipped: [url] });
        expect(mockWorkerInstances).toHaveLength(0);
        const first = handleFetchEpg([url], {}, true);
        const duplicate = handleFetchEpg([url], {}, true);
        await flushPromises();
        expect(mockWorkerInstances).toHaveLength(1);
        mockWorkerInstances[0].emit('message', { type: 'EPG_COMPLETE' });
        await Promise.all([first, duplicate]);
    });

    it('does not revive an IPC batch retired while waiting for global clear', async () => {
        const { handleFetchEpg } = await import('./epg-fetch.service');
        const { epgWorkerService: service } =
            await import('./epg-worker.service');
        const clear = service.clearEpgData();
        const batch = handleFetchEpg(
            ['https://queued-during-clear/epg'],
            {},
            true
        );
        const repeated = service.clearEpgData();
        await flushPromises();
        mockWorkerInstances[0].emit('message', { type: 'CLEAR_COMPLETE' });
        await Promise.all([clear, repeated]);
        await flushPromises();
        for (const worker of mockWorkerInstances.slice(1))
            worker.emit('message', { type: 'EPG_COMPLETE' });
        await batch;
        expect(mockWorkerInstances).toHaveLength(1);
    });

    it('does not clear past a failed worker shutdown already removed from the active lookup', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const fetch = service
            .fetchEpgFromUrl('https://failed-stop/epg')
            .catch(() => undefined);
        const writer = mockWorkerInstances[0];
        writer.terminate.mockRejectedValue(new Error('still running'));
        writer.emit('error', new Error('import failed'));
        await fetch;
        const outcome = service.clearEpgData().then(
            () => 'cleared',
            (error: Error) => error.message
        );
        await flushPromises();
        for (const worker of mockWorkerInstances.slice(1))
            worker.emit('message', { type: 'CLEAR_COMPLETE' });
        expect(await outcome).toBe('still running');
        expect(mockWorkerInstances).toHaveLength(1);
    });
    it('serializes repeated source clears that arrive behind a global clear', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const global = service.clearEpgData();
        const first = service.clearEpgDataForSource('https://same/epg');
        const second = service.clearEpgDataForSource('https://same/epg');
        await flushPromises();
        mockWorkerInstances[0].emit('message', { type: 'CLEAR_COMPLETE' });
        await global;
        await flushPromises();
        const afterGlobal = mockWorkerInstances.length;
        mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
        await first;
        await flushPromises();
        mockWorkerInstances[2].emit('message', { type: 'CLEAR_COMPLETE' });
        await second;
        expect(afterGlobal).toBe(2);
    });
    it('invalidates the session success marker when a forced refresh fails', async () => {
        const service = new EpgWorkerService('[Test EPG]', 1000);
        const url = 'https://force-fails/epg';
        service.markFetchedUrl(url);
        const fetch = service
            .fetchEpgFromUrl(url, {}, true)
            .catch(() => undefined);
        mockWorkerInstances[0].emit('message', {
            type: 'EPG_ERROR',
            error: 'failed refresh',
        });
        await fetch;
        expect(service.hasFetchedUrl(url)).toBe(false);
    });
    it.each(['EPG_COMPLETE', 'EPG_ERROR'])(
        'refresh after %s waits for termination and starts one replacement with terminal progress',
        async (type) => {
            const { handleFetchEpg } = await import('./epg-fetch.service');
            const { epgWorkerService: service } =
                await import('./epg-worker.service');
            const url = 'https://settling.example/epg';
            const progress = jest.spyOn(service, 'sendProgressToRenderer');
            const first = handleFetchEpg([url], {}, true);
            const worker = mockWorkerInstances[0];
            let finish!: () => void;
            worker.terminate.mockReturnValue(
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
            );
            worker.emit('message', { type, error: 'old import failed' });
            const options = { trustedInsecureTlsHosts: ['settling.example'] };
            const refresh = handleFetchEpg([url], options, true);
            const duplicate = handleFetchEpg([url], options, true);
            expect(mockWorkerInstances).toHaveLength(1);
            finish();
            await first;
            await flushPromises();
            const replacement = mockWorkerInstances[1];
            if (replacement) {
                replacement.emit('message', { type: 'READY' });
                replacement.emit('message', { type: 'EPG_COMPLETE' });
            }
            expect(await refresh).toMatchObject({ success: true });
            expect(await duplicate).toMatchObject({ success: true });
            expect(mockWorkerInstances).toHaveLength(2);
            expect(replacement.postMessage).toHaveBeenCalledWith({
                type: 'FETCH_EPG',
                url,
                options,
            });
            expect(progress.mock.calls.at(-1)?.[1]).toBe('complete');
        }
    );
});
