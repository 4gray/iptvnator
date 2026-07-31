import {
    EnvironmentInjector,
    Injector,
    Signal,
    WritableSignal,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
} from '@angular/core';
import type {
    DownloadMetadataSnapshot,
    ElectronBridgeDownloadStartPayload,
} from '@iptvnator/shared/interfaces';
import { DownloadItem, DownloadsService } from './downloads.service';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

type TestDownloadsService = {
    downloads: WritableSignal<DownloadItem[]>;
    downloadFolder: WritableSignal<string>;
    isAvailable: () => boolean;
    isLoadingDownloads: Signal<boolean>;
    hasLoadedDownloads: Signal<boolean>;
    getDownload: DownloadsService['getDownload'];
    loadDownloads: DownloadsService['loadDownloads'];
    loadDownloadFolder: DownloadsService['loadDownloadFolder'];
    pauseDownload: DownloadsService['pauseDownload'];
    redownloadMissing: DownloadsService['redownloadMissing'];
    resumeDownload: DownloadsService['resumeDownload'];
    selectFolder: DownloadsService['selectFolder'];
    startDownload: DownloadsService['startDownload'];
    updateMetadata: DownloadsService['updateMetadata'];
    _isLoadingDownloads: WritableSignal<boolean>;
    _hasLoadedDownloads: WritableSignal<boolean>;
    loadDownloadsRequestId: number;
};

type DownloadsElectronStub = {
    downloadsGetDefaultFolder?: jest.Mock<Promise<string>, []>;
    downloadsStart?: jest.Mock<
        Promise<{ success: boolean; id?: number; error?: string }>,
        [ElectronBridgeDownloadStartPayload]
    >;
    downloadsUpdateMetadata?: jest.Mock<
        Promise<{ success: boolean; error?: string }>,
        [number, DownloadMetadataSnapshot]
    >;
    downloadsPause?: jest.Mock<Promise<{ success: boolean }>, [number]>;
    downloadsRedownloadMissing?: jest.Mock<
        Promise<{ success: boolean; recovered?: boolean }>,
        [number]
    >;
    downloadsResume?: jest.Mock<
        Promise<{ success: boolean }>,
        [number, string]
    >;
    downloadsSelectFolder?: jest.Mock<Promise<string | null>, []>;
    downloadsGetList: jest.Mock<Promise<DownloadItem[]>, []>;
};

const metadataSnapshot: DownloadMetadataSnapshot = {
    version: 1,
    language: 'en',
    mediaKind: 'movie',
    title: 'Offline Movie',
    plot: 'Stored for offline details.',
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

    function createMetadataUpdateMock(result: {
        success: boolean;
        error?: string;
    }) {
        return jest
            .fn<
                Promise<{ success: boolean; error?: string }>,
                [number, DownloadMetadataSnapshot]
            >()
            .mockResolvedValue(result);
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

    it('exposes a download metadata snapshot on list items', () => {
        const item: DownloadItem = {
            ...createDownload(42),
            metadataSnapshot,
        };

        expect(item.metadataSnapshot).toBe(metadataSnapshot);
    });

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

    it('loads the global download list without a playlist filter and tracks request state', async () => {
        const item = createDownload(1);
        const pending = createDeferred<DownloadItem[]>();
        const electron = {
            downloadsGetList: jest.fn(() => pending.promise),
        };
        testWindow.electron = electron;
        const service = createService();

        const request = service.loadDownloads();

        expect(service.isLoadingDownloads()).toBe(true);
        expect(service.hasLoadedDownloads()).toBe(false);
        expect(electron.downloadsGetList).toHaveBeenCalledWith();

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

    it('forwards a metadata snapshot unchanged when starting a download', async () => {
        const electron = {
            downloadsGetDefaultFolder: jest.fn(async () => '/downloads'),
            downloadsGetList: jest.fn(async () => []),
            downloadsStart: jest
                .fn<
                    Promise<{ id: number; success: boolean }>,
                    [ElectronBridgeDownloadStartPayload]
                >()
                .mockResolvedValue({ id: 42, success: true }),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(
            service.startDownload({
                playlistId: 'playlist-1',
                xtreamId: 7,
                contentType: 'vod',
                title: 'Offline Movie',
                url: 'https://example.com/movie.mp4',
                metadataSnapshot,
            })
        ).resolves.toEqual({ id: 42, success: true });

        expect(electron.downloadsStart).toHaveBeenCalledWith({
            playlistId: 'playlist-1',
            xtreamId: 7,
            contentType: 'vod',
            title: 'Offline Movie',
            url: 'https://example.com/movie.mp4',
            metadataSnapshot,
            downloadFolder: '/downloads',
        });
        expect(electron.downloadsStart.mock.calls[0][0].metadataSnapshot).toBe(
            metadataSnapshot
        );
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

    it('forwards pause requests to the main process', async () => {
        const electron = {
            downloadsGetList: jest.fn(async () => []),
            downloadsPause: jest.fn(async (downloadId: number) => ({
                success: downloadId === 42,
            })),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(service.pauseDownload(42)).resolves.toEqual({
            success: true,
        });
        expect(electron.downloadsPause).toHaveBeenCalledWith(42);
    });

    it('resolves the authorized folder before resuming a paused download', async () => {
        const electron = {
            downloadsGetDefaultFolder: jest.fn(async () => '/downloads'),
            downloadsGetList: jest.fn(async () => []),
            downloadsResume: jest.fn(
                async (downloadId: number, downloadFolder: string) => ({
                    success:
                        downloadId === 42 && downloadFolder === '/downloads',
                })
            ),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(service.resumeDownload(42)).resolves.toEqual({
            success: true,
        });
        expect(electron.downloadsResume).toHaveBeenCalledWith(42, '/downloads');
    });

    it('re-downloads a missing completed file by managed id', async () => {
        const electron = {
            downloadsGetList: jest.fn(async () => []),
            downloadsRedownloadMissing: jest.fn(async (downloadId: number) => ({
                success: downloadId === 42,
            })),
        };
        testWindow.electron = electron;
        const service = createService() as unknown as DownloadsService;

        await expect(service.redownloadMissing(42)).resolves.toEqual({
            success: true,
        });
        expect(electron.downloadsRedownloadMissing).toHaveBeenCalledWith(42);
    });

    it('gets a download from the current signal by managed id', () => {
        const matching = {
            ...createDownload(42),
            metadataSnapshot,
        };
        const service = createService([createDownload(7), matching]);

        expect(service.getDownload(42)).toBe(matching);
        expect(service.getDownload(99)).toBeUndefined();
    });

    it('updates metadata by managed id and reloads the authoritative list on success', async () => {
        const refreshed = {
            ...createDownload(42),
            metadataSnapshot,
        };
        const electron = {
            downloadsGetList: jest.fn(async () => [refreshed]),
            downloadsUpdateMetadata: createMetadataUpdateMock({
                success: true,
            }),
        };
        testWindow.electron = electron;
        const service = createService([createDownload(42)]);

        await expect(
            service.updateMetadata(42, metadataSnapshot)
        ).resolves.toEqual({ success: true });

        expect(electron.downloadsUpdateMetadata).toHaveBeenCalledWith(
            42,
            metadataSnapshot
        );
        expect(electron.downloadsGetList).toHaveBeenCalledTimes(1);
        expect(service.downloads()).toEqual([refreshed]);
    });

    it('returns a metadata update bridge failure without reloading', async () => {
        const electron = {
            downloadsGetList: jest.fn(async () => []),
            downloadsUpdateMetadata: createMetadataUpdateMock({
                error: 'Metadata rejected',
                success: false,
            }),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(
            service.updateMetadata(42, metadataSnapshot)
        ).resolves.toEqual({
            error: 'Metadata rejected',
            success: false,
        });
        expect(electron.downloadsGetList).not.toHaveBeenCalled();
    });

    it('does not touch the bridge when metadata updates are unavailable', async () => {
        const electron = {
            downloadsGetList: jest.fn(async () => []),
            downloadsUpdateMetadata: createMetadataUpdateMock({
                success: true,
            }),
        };
        testWindow.electron = electron;
        const service = createService();
        service.isAvailable = () => false;

        await expect(
            service.updateMetadata(42, metadataSnapshot)
        ).resolves.toEqual({ success: false });
        expect(electron.downloadsUpdateMetadata).not.toHaveBeenCalled();
        expect(electron.downloadsGetList).not.toHaveBeenCalled();
    });

    it('returns a safe failure when the metadata update bridge throws', async () => {
        const error = new Error('metadata update failed');
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const electron = {
            downloadsGetList: jest.fn(async () => []),
            downloadsUpdateMetadata: jest
                .fn<
                    Promise<{ success: boolean; error?: string }>,
                    [number, DownloadMetadataSnapshot]
                >()
                .mockRejectedValue(error),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(
            service.updateMetadata(42, metadataSnapshot)
        ).resolves.toEqual({
            error: 'metadata update failed',
            success: false,
        });
        expect(electron.downloadsGetList).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            '[DownloadsService] Metadata update error:',
            error
        );
    });

    it('stringifies a non-Error metadata update failure', async () => {
        const error = { message: 404 };
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const electron = {
            downloadsGetList: jest.fn(async () => []),
            downloadsUpdateMetadata: jest
                .fn<
                    Promise<{ success: boolean; error?: string }>,
                    [number, DownloadMetadataSnapshot]
                >()
                .mockRejectedValue(error),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(
            service.updateMetadata(42, metadataSnapshot)
        ).resolves.toEqual({
            error: '[object Object]',
            success: false,
        });
        expect(console.error).toHaveBeenCalledWith(
            '[DownloadsService] Metadata update error:',
            error
        );
    });

    it('returns a safe failure when the metadata reload throws', async () => {
        const error = new Error('metadata reload failed');
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const electron = {
            downloadsGetList: jest.fn(async () => []),
            downloadsUpdateMetadata: createMetadataUpdateMock({
                success: true,
            }),
        };
        testWindow.electron = electron;
        const service = createService();
        service.loadDownloads = jest.fn().mockRejectedValue(error);

        await expect(
            service.updateMetadata(42, metadataSnapshot)
        ).resolves.toEqual({
            error: 'metadata reload failed',
            success: false,
        });
        expect(console.error).toHaveBeenCalledWith(
            '[DownloadsService] Metadata update error:',
            error
        );
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

        const firstRequest = service.loadDownloads();
        const secondRequest = service.loadDownloads();

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
        expect(electron.downloadsGetList).toHaveBeenNthCalledWith(1);
        expect(electron.downloadsGetList).toHaveBeenNthCalledWith(2);
    });

    it('reports paused content and resumes it by content identity', async () => {
        const pausedItem = {
            ...createDownload(7),
            status: 'paused' as DownloadItem['status'],
        };
        const service = createService([
            pausedItem,
            createDownload(8),
        ]) as unknown as DownloadsService;
        const resumeDownload = jest.fn().mockResolvedValue({ success: true });
        (service as unknown as { resumeDownload: jest.Mock }).resumeDownload =
            resumeDownload;

        expect(service.isPaused(7, 'playlist-1', 'vod')).toBe(true);
        expect(service.isPaused(8, 'playlist-1', 'vod')).toBe(false);

        await expect(
            service.resumeDownloadByContent(7, 'playlist-1', 'vod')
        ).resolves.toEqual({ success: true });
        expect(resumeDownload).toHaveBeenCalledWith(7);
    });

    it('only exposes completed files that are currently available', () => {
        const available = {
            ...createDownload(20),
            fileAvailability: 'available' as const,
            filePath: '/downloads/available.mp4',
        };
        const missing = {
            ...createDownload(21),
            fileAvailability: 'missing' as const,
            filePath: '/downloads/missing.mp4',
        };
        const service = createService([
            available,
            missing,
        ]) as unknown as DownloadsService;

        expect(service.isDownloaded(20, 'playlist-1', 'vod')).toBe(true);
        expect(service.getDownloadedFilePath(20, 'playlist-1', 'vod')).toBe(
            '/downloads/available.mp4'
        );
        expect(service.isDownloaded(21, 'playlist-1', 'vod')).toBe(false);
        expect(
            service.getDownloadedFilePath(21, 'playlist-1', 'vod')
        ).toBeUndefined();
    });

    it('rejects resume-by-content when the download is not paused', async () => {
        const service = createService([
            createDownload(8),
        ]) as unknown as DownloadsService;
        const resumeDownload = jest.fn();
        (service as unknown as { resumeDownload: jest.Mock }).resumeDownload =
            resumeDownload;

        await expect(
            service.resumeDownloadByContent(8, 'playlist-1', 'vod')
        ).resolves.toEqual({
            error: 'No paused download found',
            success: false,
        });
        expect(resumeDownload).not.toHaveBeenCalled();
    });
});
