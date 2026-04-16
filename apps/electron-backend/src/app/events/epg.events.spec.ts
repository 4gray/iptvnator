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
