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

import { epgSourceGeneration, retireEpgSource } from './epg-source-generation';
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

    it('keeps source credentials out of completion, reuse, cache and cleanup logs', async () => {
        const secretUrl =
            'https://secret-user:secret-password@example.com/private-key/guide.xml?custom=secret-query#secret-fragment';
        const first = service.fetchEpgFromUrl(secretUrl);
        const reused = service.fetchEpgFromUrl(secretUrl);
        mockWorkerInstances[0].emit('message', {
            type: 'EPG_COMPLETE',
            stats: { totalChannels: 1, totalPrograms: 2 },
        });
        await Promise.all([first, reused]);
        await service.fetchEpgFromUrl(secretUrl);
        const clear = service.clearEpgDataForSource(secretUrl);
        mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
        await clear;
        const output = JSON.stringify(consoleLogSpy.mock.calls);
        for (const secret of [
            'secret-user',
            'secret-password',
            'private-key',
            'secret-query',
            'secret-fragment',
        ]) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('EPG parsing complete');
    });

    it('redacts worker errors without changing the rejected error', async () => {
        const secretUrl =
            'https://user:password@example.com/path-token/guide.xml?custom=query-token';
        const error = Object.assign(new Error(`Request failed: ${secretUrl}`), {
            config: {
                url: secretUrl,
                headers: { Authorization: 'Bearer header-secret' },
            },
            cause: new Error(
                'Redirect failed: https://example.org/redirect-token?custom=redirect-query'
            ),
        });
        const pending = service.fetchEpgFromUrl(secretUrl);
        mockWorkerInstances[0].emit('error', error);
        await expect(pending).rejects.toBe(error);
        const output = JSON.stringify(consoleErrorSpy.mock.calls);
        for (const secret of [
            'password',
            'path-token',
            'query-token',
            'header-secret',
            'redirect-token',
            'redirect-query',
        ]) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('Request failed');
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

        it('refuses a local file the authorizer denies without spawning a worker', async () => {
            const localPath = '/home/user/epg/guide.xml.gz';
            const progressSpy = jest.spyOn(service, 'sendProgressToRenderer');
            service.localSourceAuthorizer = {
                authorize: jest.fn(),
                ensureAllowed: jest.fn().mockResolvedValue(false),
            };

            await expect(
                service.fetchEpgFromUrl(localPath, {
                    allowLocalFile: true,
                } as any)
            ).rejects.toThrow('was not allowed');

            expect(
                service.localSourceAuthorizer.ensureAllowed
            ).toHaveBeenCalledWith(localPath);
            expect(mockWorkerInstances).toHaveLength(0);
            expect(progressSpy).toHaveBeenCalledWith(
                localPath,
                'error',
                undefined,
                expect.stringContaining('was not allowed')
            );
            expect(service.hasFetchedUrl(localPath)).toBe(false);
        });

        it('cancels a local source retired while its authorization prompt is open', async () => {
            const localPath = '/home/user/epg/retired.xml.gz';
            const progressSpy = jest.spyOn(service, 'sendProgressToRenderer');
            let answer: (allowed: boolean) => void = () => undefined;
            service.localSourceAuthorizer = {
                authorize: jest.fn(),
                ensureAllowed: jest.fn(
                    () =>
                        new Promise<boolean>((resolve) => {
                            answer = resolve;
                        })
                ),
            };

            const fetchPromise = service.fetchEpgFromUrl(localPath);
            await Promise.resolve();
            retireEpgSource(localPath);
            answer(true);

            await expect(fetchPromise).resolves.toBeUndefined();
            expect(mockWorkerInstances).toHaveLength(0);
            expect(progressSpy).toHaveBeenCalledWith(
                localPath,
                'cancelled',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                0
            );
        });

        it('unlocks the worker local branch only for an allowed file', async () => {
            const localPath = '/home/user/epg/guide.xml.gz';
            service.localSourceAuthorizer = {
                authorize: jest.fn(),
                ensureAllowed: jest.fn().mockResolvedValue(true),
            };

            const fetchPromise = service.fetchEpgFromUrl(localPath, {
                trustedInsecureTlsHosts: ['example.com'],
            });
            await Promise.resolve();
            const worker = mockWorkerInstances[0];
            worker.emit('message', { type: 'READY' });

            expect(worker.postMessage).toHaveBeenCalledWith({
                type: 'FETCH_EPG',
                url: localPath,
                options: {
                    trustedInsecureTlsHosts: ['example.com'],
                    allowLocalFile: true,
                },
            });

            worker.emit('message', {
                type: 'EPG_COMPLETE',
                stats: { totalChannels: 1, totalPrograms: 1 },
            });
            await expect(fetchPromise).resolves.toBeUndefined();
        });

        it('never forwards a renderer-supplied allowLocalFile flag for remote sources', async () => {
            const fetchPromise = service.fetchEpgFromUrl(url, {
                allowLocalFile: true,
            } as any);
            await Promise.resolve();
            const worker = mockWorkerInstances[0];
            worker.emit('message', { type: 'READY' });

            expect(worker.postMessage).toHaveBeenCalledWith({
                type: 'FETCH_EPG',
                url,
                options: {},
            });
            worker.emit('message', {
                type: 'EPG_COMPLETE',
                stats: { totalChannels: 1, totalPrograms: 1 },
            });
            await expect(fetchPromise).resolves.toBeUndefined();
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

        it('queues different URLs until the previous import terminates', async () => {
            const otherUrl = 'https://example.org/other-guide.xml';
            const firstPromise = service.fetchEpgFromUrl(url);
            const secondPromise = service.fetchEpgFromUrl(otherUrl);

            expect(mockWorkerInstances).toHaveLength(1);
            mockWorkerInstances[0].emit('message', { type: 'EPG_COMPLETE' });
            await firstPromise;
            await new Promise((resolve) => setImmediate(resolve));
            expect(mockWorkerInstances).toHaveLength(2);
            mockWorkerInstances[1].emit('message', { type: 'EPG_COMPLETE' });
            await secondPromise;
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
    it('refuses a replacement while a completed worker still cannot terminate', async () => {
        const progress = jest.spyOn(service, 'sendProgressToRenderer');
        const first = service.fetchEpgFromUrl(url);
        const worker = mockWorkerInstances[0];
        worker.terminate.mockRejectedValue(new Error('still running'));
        worker.emit('message', { type: 'EPG_COMPLETE' });
        await first;
        const retry = service.fetchEpgFromUrl(url, {}, true).then(
            () => 'started',
            (error: Error) => error.message
        );
        await new Promise((resolve) => setImmediate(resolve));
        for (const replacement of mockWorkerInstances.slice(1))
            replacement.emit('message', { type: 'EPG_COMPLETE' });
        expect(await retry).toBe('still running');
        expect(mockWorkerInstances).toHaveLength(1);
        expect(progress.mock.calls.at(-1)?.[1]).toBe('error');
        worker.terminate.mockResolvedValue(0);
        const next = service.fetchEpgFromUrl(url, {}, true);
        await new Promise((resolve) => setImmediate(resolve));
        mockWorkerInstances[1].emit('message', { type: 'EPG_COMPLETE' });
        await next;
        expect(mockWorkerInstances).toHaveLength(2);
    });

    it.each([
        ['EPG_COMPLETE', 'all'],
        ['EPG_COMPLETE', 'source'],
        ['EPG_ERROR', 'all'],
        ['EPG_ERROR', 'source'],
    ] as const)(
        'does not revive a forced replacement retired during %s shutdown by %s clear',
        async (type, clearKind) => {
            const progress = jest.spyOn(service, 'sendProgressToRenderer');
            const first = service.fetchEpgFromUrl(url).catch(() => undefined);
            const worker = mockWorkerInstances[0];
            let finish!: () => void;
            worker.terminate.mockReturnValue(
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
            );
            worker.emit('message', { type, error: 'old error' });
            const retry = service.fetchEpgFromUrl(url, {}, true);
            const generation = epgSourceGeneration(url);
            const clear =
                clearKind === 'all'
                    ? service.clearEpgData()
                    : service.clearEpgDataForSource(url);
            finish();
            await first;
            await new Promise((resolve) => setImmediate(resolve));
            expect(mockWorkerInstances).toHaveLength(2);
            mockWorkerInstances[1].emit('message', { type: 'READY' });
            mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
            await Promise.all([retry, clear]);
            expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledWith(
                clearKind === 'all'
                    ? { type: 'CLEAR_EPG' }
                    : { type: 'CLEAR_EPG_SOURCE', sourceUrl: url }
            );
            expect(progress.mock.calls.at(-1)?.[1]).toBe('cancelled');
            expect(progress.mock.calls.at(-1)?.[7]).toBe(generation);
        }
    );

    it('shares a local permission prompt between simultaneous forced imports', async () => {
        let approve!: (allowed: boolean) => void;
        const ensureAllowed = jest.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    approve = resolve;
                })
        );
        service.localSourceAuthorizer = { ensureAllowed, authorize: jest.fn() };
        const localUrl = '/tmp/force-prompt.xml';
        const first = service.fetchEpgFromUrl(localUrl, {}, true);
        const duplicate = service.fetchEpgFromUrl(localUrl, {}, true);
        expect(ensureAllowed).toHaveBeenCalledTimes(1);
        expect(mockWorkerInstances).toHaveLength(0);
        approve(true);
        await new Promise((resolve) => setImmediate(resolve));
        mockWorkerInstances[0].emit('message', { type: 'EPG_COMPLETE' });
        await Promise.all([first, duplicate]);
        expect(mockWorkerInstances).toHaveLength(1);
    });

    it('does not let another source bypass a pending retry of a failed shutdown', async () => {
        const first = service.fetchEpgFromUrl(url);
        const worker = mockWorkerInstances[0];
        worker.terminate.mockRejectedValueOnce(new Error('shutdown failed'));
        worker.emit('message', { type: 'EPG_COMPLETE' });
        await first;
        let finish!: () => void;
        worker.terminate.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve;
            })
        );
        const retry = service.fetchEpgFromUrl(url, {}, true);
        const other = service.fetchEpgFromUrl(
            'https://other.example/epg',
            {},
            true
        );
        const beforeExit = mockWorkerInstances.length;
        finish();
        await new Promise((resolve) => setImmediate(resolve));
        expect(mockWorkerInstances).toHaveLength(2);
        mockWorkerInstances[1].emit('message', { type: 'EPG_COMPLETE' });
        await retry;
        await new Promise((resolve) => setImmediate(resolve));
        mockWorkerInstances[2].emit('message', { type: 'EPG_COMPLETE' });
        await other;
        expect(beforeExit).toBe(1);
        expect(mockWorkerInstances).toHaveLength(3);
    });
    it.each(['fetch', 'clear'])(
        'refuses source cleanup after a %s shutdown failed and permits a successful retry',
        async (kind) => {
            const first = (
                kind === 'fetch'
                    ? service.fetchEpgFromUrl(url)
                    : service.clearEpgDataForSource(url)
            ).catch(() => undefined);
            const worker = mockWorkerInstances[0];
            worker.terminate.mockRejectedValue(new Error('still running'));
            worker.emit('message', {
                type: 'EPG_ERROR',
                error: 'first operation failed',
            });
            await first;
            const clear = service.clearEpgDataForSource(url).then(
                () => 'cleared',
                (error: Error) => error.message
            );
            await new Promise((resolve) => setImmediate(resolve));
            for (const replacement of mockWorkerInstances.slice(1))
                replacement.emit('message', { type: 'CLEAR_COMPLETE' });
            expect(await clear).toBe('still running');
            expect(mockWorkerInstances).toHaveLength(1);
            worker.terminate.mockResolvedValue(0);
            const retry = service.clearEpgDataForSource(url);
            await new Promise((resolve) => setImmediate(resolve));
            mockWorkerInstances[1].emit('message', { type: 'READY' });
            mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
            await retry;
            expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledWith({
                type: 'CLEAR_EPG_SOURCE',
                sourceUrl: url,
            });
            expect(worker.terminate).toHaveBeenCalledTimes(3);
        }
    );

    it.each(['pending', 'failed'])(
        'rechecks %s shutdown created while a local permission prompt was open',
        async (state) => {
            let approve!: (allowed: boolean) => void;
            service.localSourceAuthorizer = {
                authorize: jest.fn(),
                ensureAllowed: jest
                    .fn()
                    .mockImplementationOnce(
                        () =>
                            new Promise<boolean>((resolve) => {
                                approve = resolve;
                            })
                    )
                    .mockResolvedValue(true),
            };
            const progress = jest.spyOn(service, 'sendProgressToRenderer');
            const localUrl = '/tmp/prompt-shutdown.xml';
            const local = service.fetchEpgFromUrl(localUrl).then(
                () => 'imported',
                (error: Error) => error.message
            );
            const remote = service.fetchEpgFromUrl(url).catch(() => undefined);
            const worker = mockWorkerInstances[0];
            let finish!: () => void;
            if (state === 'failed')
                worker.terminate.mockRejectedValue(new Error('still running'));
            else
                worker.terminate.mockReturnValue(
                    new Promise<void>((resolve) => {
                        finish = resolve;
                    })
                );
            worker.emit('message', {
                type: 'EPG_ERROR',
                error: 'remote failed',
            });
            if (state === 'failed') await remote;
            approve(true);
            await new Promise((resolve) => setImmediate(resolve));
            const beforeShutdown = mockWorkerInstances.length;
            if (state === 'pending') finish();
            await remote;
            await new Promise((resolve) => setImmediate(resolve));
            for (const replacement of mockWorkerInstances.slice(1))
                replacement.emit('message', { type: 'EPG_COMPLETE' });
            const result = await local;
            expect(beforeShutdown).toBe(1);
            expect(result).toBe(
                state === 'failed' ? 'still running' : 'imported'
            );
            if (state === 'failed') {
                expect(progress.mock.calls.at(-1)?.[1]).toBe('error');
                worker.terminate.mockResolvedValue(0);
                const retry = service.fetchEpgFromUrl(localUrl, {}, true);
                await new Promise((resolve) => setImmediate(resolve));
                mockWorkerInstances[1].emit('message', {
                    type: 'EPG_COMPLETE',
                });
                await retry;
            }
            expect(mockWorkerInstances).toHaveLength(2);
        }
    );

    it.each(['fetch', 'clear'])(
        'rechecks a newer shutdown before admitting a %s worker after an earlier shutdown',
        async (kind) => {
            // Different source clears can overlap; their shutdowns must still
            // fence every later writer, even though imports are serialized.
            const first = service.clearEpgDataForSource(url);
            const second = service.clearEpgDataForSource(
                'https://second-running.example/epg'
            );
            let finishFirst!: () => void;
            let finishSecond!: () => void;
            mockWorkerInstances[0].terminate.mockReturnValue(
                new Promise<void>((resolve) => {
                    finishFirst = resolve;
                })
            );
            mockWorkerInstances[1].terminate.mockReturnValue(
                new Promise<void>((resolve) => {
                    finishSecond = resolve;
                })
            );
            mockWorkerInstances[0].emit('message', { type: 'CLEAR_COMPLETE' });
            const admitted =
                kind === 'fetch'
                    ? service.fetchEpgFromUrl('https://next.example/epg')
                    : service.clearEpgDataForSource('https://next.example/epg');
            mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
            finishFirst();
            await first;
            await new Promise((resolve) => setImmediate(resolve));
            const beforeSecondExit = mockWorkerInstances.length;
            finishSecond();
            await second;
            await new Promise((resolve) => setImmediate(resolve));
            mockWorkerInstances[2].emit('message', {
                type: kind === 'fetch' ? 'EPG_COMPLETE' : 'CLEAR_COMPLETE',
            });
            await admitted;
            expect(beforeSecondExit).toBe(2);
            expect(mockWorkerInstances).toHaveLength(3);
        }
    );

    it.each(['all', 'source'])(
        'cancels a local approval waiting for shutdown when %s clear retires its generation',
        async (kind) => {
            let approve!: (allowed: boolean) => void;
            service.localSourceAuthorizer = {
                authorize: jest.fn(),
                ensureAllowed: () =>
                    new Promise<boolean>((resolve) => {
                        approve = resolve;
                    }),
            };
            const localUrl = '/tmp/retired-prompt.xml';
            const progress = jest.spyOn(service, 'sendProgressToRenderer');
            const local = service.fetchEpgFromUrl(localUrl);
            const remote = service.fetchEpgFromUrl(url).catch(() => undefined);
            let finish!: () => void;
            mockWorkerInstances[0].terminate.mockReturnValue(
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
            );
            mockWorkerInstances[0].emit('message', {
                type: 'EPG_ERROR',
                error: 'remote failed',
            });
            approve(true);
            await new Promise((resolve) => setImmediate(resolve));
            const generation = epgSourceGeneration(localUrl);
            const clear =
                kind === 'all'
                    ? service.clearEpgData()
                    : service.clearEpgDataForSource(localUrl);
            finish();
            await remote;
            await new Promise((resolve) => setImmediate(resolve));
            expect(mockWorkerInstances).toHaveLength(2);
            mockWorkerInstances[1].emit('message', { type: 'READY' });
            mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
            await Promise.all([local, clear]);
            expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledWith(
                kind === 'all'
                    ? { type: 'CLEAR_EPG' }
                    : { type: 'CLEAR_EPG_SOURCE', sourceUrl: localUrl }
            );
            expect(progress.mock.calls.at(-1)?.[1]).toBe('cancelled');
            expect(progress.mock.calls.at(-1)?.[7]).toBe(generation);
        }
    );
    it('blocks another source until the active source-clear writer has stopped', async () => {
        const progress = jest.spyOn(service, 'sendProgressToRenderer');
        const first = service.fetchEpgFromUrl(url);
        const generation = epgSourceGeneration(url);
        const worker = mockWorkerInstances[0];
        let finish!: () => void;
        worker.terminate.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = () => {
                    worker.emit('exit', 1);
                    resolve();
                };
            })
        );
        const clear = service.clearEpgDataForSource(url);
        const other = service.fetchEpgFromUrl(
            'https://other-source.example/epg'
        );
        await new Promise((resolve) => setImmediate(resolve));
        const beforeExit = mockWorkerInstances.length;
        finish();
        await first;
        await new Promise((resolve) => setImmediate(resolve));
        for (const next of mockWorkerInstances.slice(1)) {
            next.emit('message', { type: 'READY' });
            next.emit('message', {
                type:
                    next.postMessage.mock.calls[0][0].type === 'FETCH_EPG'
                        ? 'EPG_COMPLETE'
                        : 'CLEAR_COMPLETE',
            });
        }
        await Promise.all([clear, other]);
        expect(beforeExit).toBe(1);
        expect(mockWorkerInstances).toHaveLength(3);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(progress).toHaveBeenCalledWith(
            url,
            'cancelled',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            generation
        );
    });

    it('blocks another source after direct source shutdown fails and permits a successful retry', async () => {
        const first = service.fetchEpgFromUrl(url);
        const worker = mockWorkerInstances[0];
        worker.terminate.mockRejectedValue(new Error('still running'));
        const failedClear = service
            .clearEpgDataForSource(url)
            .catch((error: Error) => error.message);
        await failedClear;
        const otherUrl = 'https://retry-other-source.example/epg';
        const other = service.fetchEpgFromUrl(otherUrl).then(
            () => 'started',
            (error: Error) => error.message
        );
        await new Promise((resolve) => setImmediate(resolve));
        const afterFailedStop = mockWorkerInstances.length;
        for (const next of mockWorkerInstances.slice(1))
            next.emit('message', { type: 'EPG_COMPLETE' });
        const blockedResult = await other;
        let finish!: () => void;
        worker.terminate.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = () => {
                    worker.emit('exit', 1);
                    resolve();
                };
            })
        );
        const beforeRetry = mockWorkerInstances.length;
        const clear = service.clearEpgDataForSource(url);
        const retry = service.fetchEpgFromUrl(otherUrl, {}, true);
        await new Promise((resolve) => setImmediate(resolve));
        const duringRetry = mockWorkerInstances.length;
        finish();
        await first;
        await new Promise((resolve) => setImmediate(resolve));
        for (const next of mockWorkerInstances.slice(beforeRetry)) {
            next.emit('message', { type: 'READY' });
            next.emit('message', {
                type:
                    next.postMessage.mock.calls[0][0].type === 'FETCH_EPG'
                        ? 'EPG_COMPLETE'
                        : 'CLEAR_COMPLETE',
            });
        }
        await Promise.all([clear, retry]);
        expect(blockedResult).toBe('still running');
        expect(afterFailedStop).toBe(1);
        expect(duringRetry).toBe(beforeRetry);
        expect(mockWorkerInstances).toHaveLength(3);
        // The retired active import also retries shutdown at its timeout
        // before releasing the queue to the blocked request and later retry.
        expect(worker.terminate).toHaveBeenCalledTimes(4);
    });

    it('shares an active source-clear shutdown with an overlapping global clear', async () => {
        const first = service.fetchEpgFromUrl(url);
        const worker = mockWorkerInstances[0];
        let finish!: () => void;
        worker.terminate.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = () => {
                    worker.emit('exit', 1);
                    resolve();
                };
            })
        );
        const source = service.clearEpgDataForSource(url);
        const global = service.clearEpgData();
        await new Promise((resolve) => setImmediate(resolve));
        const terminationCalls = worker.terminate.mock.calls.length;
        finish();
        await first;
        await new Promise((resolve) => setImmediate(resolve));
        mockWorkerInstances[1].emit('message', { type: 'READY' });
        mockWorkerInstances[1].emit('message', { type: 'CLEAR_COMPLETE' });
        await source;
        await new Promise((resolve) => setImmediate(resolve));
        mockWorkerInstances[2].emit('message', { type: 'READY' });
        mockWorkerInstances[2].emit('message', { type: 'CLEAR_COMPLETE' });
        await global;
        expect(terminationCalls).toBe(1);
        expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledWith({
            type: 'CLEAR_EPG_SOURCE',
            sourceUrl: url,
        });
        expect(mockWorkerInstances[2].postMessage).toHaveBeenCalledWith({
            type: 'CLEAR_EPG',
        });
    });
});
