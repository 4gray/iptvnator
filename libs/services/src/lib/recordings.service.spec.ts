import {
    EnvironmentInjector,
    Injector,
    Signal,
    WritableSignal,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
} from '@angular/core';
import type { ElectronBridgeErrorResult } from '@iptvnator/shared/interfaces';
import { DownloadListLoadState } from './download-list-load-state';
import { RecordingsService } from './recordings.service';
import type { RecordingItem } from './recordings.service';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

type TestRecordingsService = {
    recordings: WritableSignal<RecordingItem[]>;
    isAvailable: () => boolean;
    isLoadingRecordings: Signal<boolean>;
    hasLoadedRecordings: Signal<boolean>;
    hasAuthoritativeRecordingList: Signal<boolean>;
    listLoadState: DownloadListLoadState;
    loadRecordings: RecordingsService['loadRecordings'];
    stopRecording: RecordingsService['stopRecording'];
    removeRecording: RecordingsService['removeRecording'];
    updatePrograms: RecordingsService['updatePrograms'];
    revealFile: RecordingsService['revealFile'];
    playFile: RecordingsService['playFile'];
};

type RecordingsElectronStub = {
    recordingsGetList?: jest.Mock;
    recordingsStop?: jest.Mock;
    recordingsRemove?: jest.Mock;
    recordingsUpdatePrograms?: jest.Mock;
    recordingsRevealFile?: jest.Mock;
    recordingsPlayFile?: jest.Mock;
    onRecordingsUpdate?: jest.Mock;
};

describe('RecordingsService', () => {
    const testWindow = window as unknown as {
        electron?: RecordingsElectronStub;
    };
    const originalElectron = testWindow.electron;

    afterEach(() => {
        testWindow.electron = originalElectron;
        jest.restoreAllMocks();
    });

    function createRecording(
        id: number,
        status: RecordingItem['status'] = 'completed',
        overrides: Partial<RecordingItem> = {}
    ): RecordingItem {
        return {
            id,
            status,
            filePath: `/recordings/${id}.ts`,
            channelName: `Channel ${id}`,
            startedAt: '2026-08-15T12:00:00Z',
            fileAvailability: 'available',
            ...overrides,
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

    /** Constructor-driven instance: init() runs against the given capability. */
    function createInjectedService(supportsRecordings: boolean) {
        const injector = createEnvironmentInjector(
            [
                RecordingsService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsRecordings },
                },
            ],
            Injector.NULL as unknown as EnvironmentInjector
        );
        const service = runInInjectionContext(
            injector,
            () => new RecordingsService()
        );
        return { injector, service };
    }

    /** Prototype-based instance: no constructor, so init() cannot interfere. */
    function createService(initial: RecordingItem[] = []) {
        const listLoadState = new DownloadListLoadState();
        const service = Object.create(
            RecordingsService.prototype
        ) as TestRecordingsService;
        Object.assign(service, {
            recordings: signal(initial),
            isAvailable: () => true,
            listLoadState,
            isLoadingRecordings: listLoadState.isLoading,
            hasLoadedRecordings: listLoadState.hasLoaded,
            hasAuthoritativeRecordingList: listLoadState.hasAuthoritativeList,
        });
        return service;
    }

    const flush = () =>
        new Promise<void>((resolve) => setTimeout(resolve, 0));

    it('never touches the bridge when recordings are unavailable', async () => {
        const electron: RecordingsElectronStub = {
            recordingsGetList: jest.fn(async () => [createRecording(1)]),
            recordingsStop: jest.fn(async () => ({ success: true })),
            onRecordingsUpdate: jest.fn(),
        };
        testWindow.electron = electron;
        const { injector, service } = createInjectedService(false);

        try {
            await flush();
            await service.loadRecordings();

            expect(service.isAvailable()).toBe(false);
            expect(service.recordings()).toEqual([]);
            expect(service.hasRecordings()).toBe(false);
            expect(electron.recordingsGetList).not.toHaveBeenCalled();
            expect(electron.onRecordingsUpdate).not.toHaveBeenCalled();

            await expect(service.stopRecording(1)).resolves.toEqual({
                error: 'Recordings are not available',
                success: false,
            });
            expect(electron.recordingsStop).not.toHaveBeenCalled();
        } finally {
            injector.destroy();
        }
    });

    it('loads once on init, subscribes to update pings, and unsubscribes on destroy', async () => {
        const initial = createRecording(1);
        const updated = createRecording(2, 'recording');
        let pushUpdate: (() => void) | undefined;
        const unsubscribe = jest.fn();
        const electron: RecordingsElectronStub = {
            recordingsGetList: jest
                .fn()
                .mockResolvedValueOnce([initial])
                .mockResolvedValueOnce([updated]),
            onRecordingsUpdate: jest.fn((callback: () => void) => {
                pushUpdate = callback;
                return unsubscribe;
            }),
        };
        testWindow.electron = electron;
        const { injector, service } = createInjectedService(true);

        try {
            await flush();

            expect(electron.recordingsGetList).toHaveBeenCalledTimes(1);
            expect(electron.onRecordingsUpdate).toHaveBeenCalledTimes(1);
            expect(service.recordings()).toEqual([initial]);
            expect(service.hasLoadedRecordings()).toBe(true);
            expect(service.hasAuthoritativeRecordingList()).toBe(true);

            pushUpdate?.();
            await flush();

            expect(electron.recordingsGetList).toHaveBeenCalledTimes(2);
            expect(service.recordings()).toEqual([updated]);

            service.ngOnDestroy();
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        } finally {
            injector.destroy();
        }
    });

    it('coalesces overlapping loads into one in-flight plus one trailing refresh', async () => {
        const inFlightItem = createRecording(1);
        const trailingItem = createRecording(2);
        const first = createDeferred<RecordingItem[]>();
        const second = createDeferred<RecordingItem[]>();
        const electron: RecordingsElectronStub = {
            recordingsGetList: jest
                .fn()
                .mockReturnValueOnce(first.promise)
                .mockReturnValueOnce(second.promise),
        };
        testWindow.electron = electron;
        const service = createService();

        const firstRequest = service.loadRecordings();
        const secondRequest = service.loadRecordings();
        const thirdRequest = service.loadRecordings();

        expect(service.isLoadingRecordings()).toBe(true);
        expect(electron.recordingsGetList).toHaveBeenCalledTimes(1);

        first.resolve([inFlightItem]);
        await firstRequest;

        expect(service.recordings()).toEqual([inFlightItem]);
        expect(service.isLoadingRecordings()).toBe(true);
        expect(electron.recordingsGetList).toHaveBeenCalledTimes(2);

        second.resolve([trailingItem]);
        await secondRequest;
        await thirdRequest;

        expect(service.recordings()).toEqual([trailingItem]);
        expect(service.isLoadingRecordings()).toBe(false);
        expect(service.hasAuthoritativeRecordingList()).toBe(true);
        expect(electron.recordingsGetList).toHaveBeenCalledTimes(2);
    });

    it('marks a failed list load non-authoritative while preserving the list and logging', async () => {
        const existing = createRecording(1);
        const error = new Error('recordings query failed');
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        testWindow.electron = {
            recordingsGetList: jest.fn().mockRejectedValue(error),
        };
        const service = createService([existing]);
        service.listLoadState.markSucceeded();

        await service.loadRecordings();

        expect(service.recordings()).toEqual([existing]);
        expect(service.isLoadingRecordings()).toBe(false);
        expect(service.hasAuthoritativeRecordingList()).toBe(false);
        expect(service.hasLoadedRecordings()).toBe(true);
        expect(console.error).toHaveBeenCalledWith(
            '[RecordingsService] Error loading recordings:',
            error
        );
    });

    it('normalizes missing bridge methods to a safe failure result', async () => {
        const electron: RecordingsElectronStub = {
            recordingsGetList: jest.fn(async () => []),
        };
        testWindow.electron = electron;
        const service = createService();
        const unavailable: ElectronBridgeErrorResult = {
            error: 'Recordings bridge unavailable',
            success: false,
        };

        await expect(service.stopRecording(1)).resolves.toEqual(unavailable);
        await expect(service.removeRecording(1)).resolves.toEqual(unavailable);
        await expect(
            service.updatePrograms('/recordings/1.ts', [])
        ).resolves.toEqual(unavailable);
        await expect(
            service.revealFile('/recordings/1.ts')
        ).resolves.toEqual(unavailable);
        await expect(
            service.playFile('/recordings/1.ts')
        ).resolves.toEqual(unavailable);
        expect(electron.recordingsGetList).not.toHaveBeenCalled();
    });

    it('passes through action results and refreshes only after a successful remove', async () => {
        const remaining = createRecording(2);
        const electron: RecordingsElectronStub = {
            recordingsGetList: jest.fn(async () => [remaining]),
            recordingsStop: jest.fn(async () => ({ success: true })),
            recordingsRemove: jest.fn(async () => ({ success: true })),
        };
        testWindow.electron = electron;
        const service = createService([
            createRecording(1),
            createRecording(2),
        ]);

        await expect(service.stopRecording(1)).resolves.toEqual({
            success: true,
        });
        expect(electron.recordingsStop).toHaveBeenCalledWith(1);
        expect(electron.recordingsGetList).not.toHaveBeenCalled();

        await expect(service.removeRecording(1)).resolves.toEqual({
            success: true,
        });
        expect(electron.recordingsRemove).toHaveBeenCalledWith(1);
        expect(electron.recordingsGetList).toHaveBeenCalledTimes(1);
        expect(service.recordings()).toEqual([remaining]);
    });

    it('does not refresh after a failed remove and reports a thrown action safely', async () => {
        const error = new Error('stop failed');
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const electron: RecordingsElectronStub = {
            recordingsGetList: jest.fn(async () => []),
            recordingsRemove: jest.fn(async () => ({
                error: 'row is busy',
                success: false,
            })),
            recordingsStop: jest.fn().mockRejectedValue(error),
        };
        testWindow.electron = electron;
        const service = createService();

        await expect(service.removeRecording(1)).resolves.toEqual({
            error: 'row is busy',
            success: false,
        });
        expect(electron.recordingsGetList).not.toHaveBeenCalled();

        await expect(service.stopRecording(1)).resolves.toEqual({
            error: 'stop failed',
            success: false,
        });
        expect(console.error).toHaveBeenCalledWith(
            '[RecordingsService] Error (stop):',
            error
        );
    });

    it('picks the row with status recording as the active recording', () => {
        const { injector, service } = createInjectedService(false);

        try {
            const active = createRecording(2, 'recording');
            service.recordings.set([
                createRecording(1),
                active,
                createRecording(3, 'failed'),
            ]);

            expect(service.activeRecording()).toBe(active);
            expect(service.hasRecordings()).toBe(true);

            service.recordings.set([createRecording(1)]);
            expect(service.activeRecording()).toBeNull();
        } finally {
            injector.destroy();
        }
    });
});
