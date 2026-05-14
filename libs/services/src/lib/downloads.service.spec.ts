import { signal, Signal, WritableSignal } from '@angular/core';
import { DownloadItem, DownloadsService } from './downloads.service';

type TestDownloadsService = {
    downloads: WritableSignal<DownloadItem[]>;
    isAvailable: () => boolean;
    isLoadingDownloads: Signal<boolean>;
    hasLoadedDownloads: Signal<boolean>;
    loadDownloads: DownloadsService['loadDownloads'];
    getThroughputBytesPerSecond: DownloadsService['getThroughputBytesPerSecond'];
    updateThroughputSamples: (items: DownloadItem[]) => void;
    _isLoadingDownloads: WritableSignal<boolean>;
    _hasLoadedDownloads: WritableSignal<boolean>;
    downloadThroughput: WritableSignal<
        Record<number, { bytesPerSecond: number; sampledAt: number }>
    >;
    previousDownloadSamples: Map<
        number,
        { bytesDownloaded: number; sampledAt: number }
    >;
    loadDownloadsRequestId: number;
};

type DownloadsElectronStub = {
    downloadsGetList: jest.Mock<Promise<DownloadItem[]>, [string?]>;
};

describe('DownloadsService', () => {
    const testWindow = window as unknown as {
        electron?: DownloadsElectronStub;
    };
    const originalElectron = testWindow.electron;

    afterEach(() => {
        testWindow.electron = originalElectron;
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    function createDownload(
        id: number,
        playlistId = 'playlist-1'
    ): DownloadItem {
        return {
            id,
            playlistId,
            xtreamId: id,
            contentType: 'vod',
            title: `Movie ${id}`,
            url: `https://example.com/${id}.mp4`,
            status: 'completed',
        };
    }

    function createDeferred<T>() {
        let resolve!: (value: T) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((promiseResolve, promiseReject) => {
            resolve = promiseResolve;
            reject = promiseReject;
        });

        return { promise, resolve, reject };
    }

    function createService(initialDownloads: DownloadItem[] = []) {
        const downloads = signal(initialDownloads);
        const isLoadingDownloads = signal(false);
        const hasLoadedDownloads = signal(false);
        const downloadThroughput = signal<
            Record<number, { bytesPerSecond: number; sampledAt: number }>
        >({});
        const service = Object.create(
            DownloadsService.prototype
        ) as TestDownloadsService;

        Object.assign(service, {
            downloads,
            isAvailable: () => true,
            _isLoadingDownloads: isLoadingDownloads,
            isLoadingDownloads: isLoadingDownloads.asReadonly(),
            _hasLoadedDownloads: hasLoadedDownloads,
            hasLoadedDownloads: hasLoadedDownloads.asReadonly(),
            downloadThroughput,
            previousDownloadSamples: new Map(),
            loadDownloadsRequestId: 0,
        });

        return service;
    }

    it('tracks loading and loaded state around a successful download list request', async () => {
        const item = createDownload(1);
        const pending = createDeferred<DownloadItem[]>();
        const electron = {
            downloadsGetList: jest.fn(() => pending.promise),
        };
        testWindow.electron = electron;
        const service = createService();

        const request = service.loadDownloads('playlist-1');

        expect(service.isLoadingDownloads()).toBe(true);
        expect(service.hasLoadedDownloads()).toBe(false);
        expect(electron.downloadsGetList).toHaveBeenCalledWith('playlist-1');

        pending.resolve([item]);
        await request;

        expect(service.downloads()).toEqual([item]);
        expect(service.isLoadingDownloads()).toBe(false);
        expect(service.hasLoadedDownloads()).toBe(true);
    });

    it('marks downloads as loaded after a failed request while preserving existing data', async () => {
        const existing = createDownload(1);
        const error = new Error('download query failed');
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        testWindow.electron = {
            downloadsGetList: jest.fn(async () => {
                throw error;
            }),
        };
        const service = createService([existing]);

        await service.loadDownloads();

        expect(service.downloads()).toEqual([existing]);
        expect(service.isLoadingDownloads()).toBe(false);
        expect(service.hasLoadedDownloads()).toBe(true);
        expect(console.error).toHaveBeenCalledWith(
            '[DownloadsService] Error loading downloads:',
            error
        );
    });

    it('keeps only the latest overlapping download list request result', async () => {
        const staleItem = createDownload(1, 'playlist-old');
        const latestItem = createDownload(2, 'playlist-new');
        const first = createDeferred<DownloadItem[]>();
        const second = createDeferred<DownloadItem[]>();
        const electron = {
            downloadsGetList: jest
                .fn()
                .mockReturnValueOnce(first.promise)
                .mockReturnValueOnce(second.promise),
        };
        testWindow.electron = electron;
        const service = createService();

        const firstRequest = service.loadDownloads('playlist-old');
        const secondRequest = service.loadDownloads('playlist-new');

        expect(service.isLoadingDownloads()).toBe(true);

        second.resolve([latestItem]);
        await secondRequest;

        expect(service.downloads()).toEqual([latestItem]);
        expect(service.isLoadingDownloads()).toBe(false);
        expect(service.hasLoadedDownloads()).toBe(true);

        first.resolve([staleItem]);
        await firstRequest;

        expect(service.downloads()).toEqual([latestItem]);
        expect(service.isLoadingDownloads()).toBe(false);
        expect(electron.downloadsGetList).toHaveBeenNthCalledWith(
            1,
            'playlist-old'
        );
        expect(electron.downloadsGetList).toHaveBeenNthCalledWith(
            2,
            'playlist-new'
        );
    });

    it('calculates live throughput from consecutive download updates', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
        const first = {
            ...createDownload(1),
            status: 'downloading' as const,
            bytesDownloaded: 1_000,
            totalBytes: 10_000,
        };
        const second = {
            ...first,
            bytesDownloaded: 5_000,
        };
        const electron = {
            downloadsGetList: jest
                .fn()
                .mockResolvedValueOnce([first])
                .mockResolvedValueOnce([second]),
        };
        testWindow.electron = electron;
        const service = createService();

        await service.loadDownloads();
        expect(service.getThroughputBytesPerSecond(first)).toBe(0);

        jest.setSystemTime(new Date('2026-05-14T12:00:02.000Z'));
        await service.loadDownloads();

        expect(service.getThroughputBytesPerSecond(second)).toBe(2_000);
    });
});
