import {
    EnvironmentInjector,
    Injector,
    Signal,
    WritableSignal,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
} from '@angular/core';
import {
    DownloadItem,
    DownloadsService,
} from './downloads.service';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

type TestDownloadsService = {
    downloads: WritableSignal<DownloadItem[]>;
    downloadFolder: WritableSignal<string>;
    isAvailable: () => boolean;
    isLoadingDownloads: Signal<boolean>;
    hasLoadedDownloads: Signal<boolean>;
    loadDownloads: DownloadsService['loadDownloads'];
    loadDownloadFolder: DownloadsService['loadDownloadFolder'];
    selectFolder: DownloadsService['selectFolder'];
    _isLoadingDownloads: WritableSignal<boolean>;
    _hasLoadedDownloads: WritableSignal<boolean>;
    loadDownloadsRequestId: number;
};

type DownloadsElectronStub = {
    downloadsGetDefaultFolder?: jest.Mock<Promise<string>, []>;
    downloadsSelectFolder?: jest.Mock<Promise<string | null>, []>;
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
    });

    function createDownload(id: number, playlistId = 'playlist-1'): DownloadItem {
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
        const downloadFolder = signal('');
        const service = Object.create(
            DownloadsService.prototype
        ) as TestDownloadsService;

        Object.assign(service, {
            downloads,
            downloadFolder,
            isAvailable: () => true,
            _isLoadingDownloads: isLoadingDownloads,
            isLoadingDownloads: isLoadingDownloads.asReadonly(),
            _hasLoadedDownloads: hasLoadedDownloads,
            hasLoadedDownloads: hasLoadedDownloads.asReadonly(),
            loadDownloadsRequestId: 0,
        });

        return service;
    }

    it('reports availability through the runtime capability', () => {
        const injector = createEnvironmentInjector(
            [
                DownloadsService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsDownloads: false },
                },
            ],
            Injector.NULL as unknown as EnvironmentInjector
        );

        try {
            const service = runInInjectionContext(
                injector,
                () => new DownloadsService()
            );

            expect(service.isAvailable()).toBe(false);
        } finally {
            injector.destroy();
        }
    });

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

    it('uses the main-process authorized download folder instead of renderer storage', async () => {
        const electron = {
            downloadsGetDefaultFolder: jest.fn(async () => '/authorized'),
            downloadsGetList: jest.fn(async () => []),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(service.loadDownloadFolder()).resolves.toBe('/authorized');
        expect(service.downloadFolder()).toBe('/authorized');
        expect(electron.downloadsGetDefaultFolder).toHaveBeenCalledTimes(1);
    });

    it('stores a selected download folder returned by the main process', async () => {
        const electron = {
            downloadsSelectFolder: jest.fn(async () => '/selected'),
            downloadsGetList: jest.fn(async () => []),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(service.selectFolder()).resolves.toBe('/selected');
        expect(service.downloadFolder()).toBe('/selected');
        expect(electron.downloadsSelectFolder).toHaveBeenCalledTimes(1);
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
});
