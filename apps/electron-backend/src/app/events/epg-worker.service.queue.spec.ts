/** Import admission across separate IPC requests; worker lifecycle stays real. */
import type { EventEmitter } from 'node:events';

interface MockWorker extends EventEmitter {
    postMessage: jest.Mock;
    terminate: jest.Mock;
}
const mockWorkers: MockWorker[] = [];
jest.mock('electron', () => ({
    app: { isPackaged: false, getAppPath: () => '/mock/app.asar' },
    BrowserWindow: { getAllWindows: () => [] },
}));
jest.mock('worker_threads', () => {
    const { EventEmitter } = require('events');
    return {
        Worker: jest.fn().mockImplementation(() => {
            const worker = new EventEmitter();
            worker.postMessage = jest.fn();
            worker.terminate = jest.fn(() => {
                worker.emit('exit', 0);
                return Promise.resolve(0);
            });
            mockWorkers.push(worker);
            return worker;
        }),
    };
});
jest.mock('../workers/worker-runtime-paths', () => ({
    resolveWorkerRuntimeBootstrap: () => ({
        workerPath: '/mock/epg-parser.worker.js',
        nativeModuleSearchPaths: [],
    }),
}));

import { EpgWorkerService } from './epg-worker.service';
import { epgSourceGeneration } from './epg-source-generation';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const firstUrl = 'https://first.example/guide';
const queuedUrl = 'https://queued.example/guide';
const complete = (worker: MockWorker) => {
    worker.emit('message', { type: 'READY' });
    const command = worker.postMessage.mock.calls[0]?.[0].type;
    if (!command) return; // Retired workers ignore READY and cannot write.
    worker.emit('message', {
        type: command === 'FETCH_EPG' ? 'EPG_COMPLETE' : 'CLEAR_COMPLETE',
    });
};

describe('EPG import queue', () => {
    let service: EpgWorkerService;
    beforeEach(() => {
        mockWorkers.length = 0;
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        service = new EpgWorkerService('[queue test]', 1000);
    });
    afterEach(() => jest.restoreAllMocks());

    it('waits for the previous worker exit and deduplicates a queued forced source with its trust options', async () => {
        const first = service.fetchEpgFromUrl(firstUrl, {}, true);
        const worker = mockWorkers[0];
        let finish!: () => void;
        worker.terminate.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
        );
        const options = { trustedInsecureTlsHosts: ['queued.example'] };
        const next = service.fetchEpgFromUrl(queuedUrl, options, true);
        const duplicate = service.fetchEpgFromUrl(queuedUrl, options, true);
        const beforeCompletion = mockWorkers.length;
        complete(worker);
        await flush();
        const beforeExit = mockWorkers.length;
        finish();
        await first;
        await flush();
        complete(mockWorkers[1]);
        await Promise.all([next, duplicate]);
        expect(beforeCompletion).toBe(1);
        expect(beforeExit).toBe(1);
        expect(mockWorkers).toHaveLength(2);
        expect(mockWorkers[1].postMessage).toHaveBeenCalledWith({
            type: 'FETCH_EPG',
            url: queuedUrl,
            options,
        });
    });

    it('continues with the next source after the first import fails', async () => {
        const first = service
            .fetchEpgFromUrl(firstUrl, {}, true)
            .catch((error: Error) => error.message);
        const next = service.fetchEpgFromUrl(queuedUrl, {}, true);
        const beforeFailure = mockWorkers.length;
        mockWorkers[0].emit('message', {
            type: 'EPG_ERROR',
            error: 'bad guide',
        });
        expect(await first).toBe('bad guide');
        await flush();
        complete(mockWorkers[1]);
        await next;
        expect(beforeFailure).toBe(1);
        expect(service.hasFetchedUrl(queuedUrl)).toBe(true);
    });

    it('fails a queued source after unconfirmed shutdown and permits a later successful retry', async () => {
        const first = service.fetchEpgFromUrl(firstUrl, {}, true);
        const worker = mockWorkers[0];
        worker.terminate.mockRejectedValue(new Error('still running'));
        const queued = service.fetchEpgFromUrl(queuedUrl, {}, true).then(
            () => 'completed',
            (error: Error) => error.message
        );
        complete(worker);
        await first;
        await flush();
        for (const extra of mockWorkers.slice(1)) complete(extra);
        expect(await queued).toBe('still running');
        expect(mockWorkers).toHaveLength(1);
        worker.terminate.mockResolvedValue(0);
        const retry = service.fetchEpgFromUrl(queuedUrl, {}, true);
        await flush();
        complete(mockWorkers[1]);
        await retry;
        expect(mockWorkers).toHaveLength(2);
    });

    it.each(['all', 'source'])(
        '%s clear retires a queued source and a fresh request does not inherit its cancelled promise',
        async (kind) => {
            const progress = jest.spyOn(service, 'sendProgressToRenderer');
            const first = service.fetchEpgFromUrl(firstUrl, {}, true);
            const retired = service.fetchEpgFromUrl(queuedUrl, {}, true);
            const generation = epgSourceGeneration(queuedUrl);
            const beforeClear = mockWorkers.length;
            const clear =
                kind === 'all'
                    ? service.clearEpgData()
                    : service.clearEpgDataForSource(queuedUrl);
            const replacement = service.fetchEpgFromUrl(queuedUrl, {}, true);
            await flush();
            // Source cleanup may run beside an unrelated active import; global
            // cleanup stops that import. Neither should start the queued source.
            if (kind === 'source') complete(mockWorkers[0]);
            await first;
            await flush();
            for (const worker of mockWorkers.slice(1)) complete(worker);
            await clear;
            await flush();
            const replacementWorker = mockWorkers[mockWorkers.length - 1];
            complete(replacementWorker);
            await Promise.all([retired, replacement]);
            expect(beforeClear).toBe(1);
            expect(mockWorkers).toHaveLength(3);
            expect(replacementWorker.postMessage).toHaveBeenCalledWith({
                type: 'FETCH_EPG',
                url: queuedUrl,
                options: {},
            });
            expect(progress).toHaveBeenCalledWith(
                queuedUrl,
                'cancelled',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                generation
            );
        }
    );

    it('keeps the import slot free while local authorization is pending and clear does not wait for approval', async () => {
        let approve!: (allowed: boolean) => void;
        service.localSourceAuthorizer = {
            authorize: jest.fn(),
            ensureAllowed: () =>
                new Promise<boolean>((resolve) => {
                    approve = resolve;
                }),
        };
        const local = service.fetchEpgFromUrl(
            '/tmp/queued-local.xml',
            {},
            true
        );
        const remote = service.fetchEpgFromUrl(firstUrl, {}, true);
        const queued = service.fetchEpgFromUrl(queuedUrl, {}, true);
        const beforeClear = mockWorkers.length;
        const clear = service.clearEpgData();
        await flush();
        for (const worker of mockWorkers.slice(1)) complete(worker);
        await clear;
        approve(true);
        await Promise.all([local, remote, queued]);
        expect(beforeClear).toBe(1);
        expect(mockWorkers).toHaveLength(2);
    });
});
