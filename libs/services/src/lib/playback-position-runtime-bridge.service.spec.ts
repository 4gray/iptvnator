import {
    DestroyableInjector,
    Injector,
    runInInjectionContext,
} from '@angular/core';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';
import { PlaybackPositionRuntimeBridgeService } from './playback-position-runtime-bridge.service';

const batchSaveItems: PlaybackPositionData[] = [
    createPosition(),
    createPosition({
        contentXtreamId: 101,
        contentType: 'episode',
        seriesXtreamId: 200,
    }),
];

const batchClearItems: {
    contentXtreamId: number;
    contentType: 'vod' | 'episode';
}[] = [
    { contentXtreamId: 100, contentType: 'vod' },
    { contentXtreamId: 101, contentType: 'episode' },
];

describe('PlaybackPositionRuntimeBridgeService', () => {
    let service: PlaybackPositionRuntimeBridgeService;
    let injector: DestroyableInjector;
    let runtimeCapabilities: {
        supportsPlaybackPositionStorage: boolean;
        supportsPlaybackPositionUpdates: boolean;
    };
    const originalElectron = window.electron;

    beforeEach(() => {
        runtimeCapabilities = {
            supportsPlaybackPositionStorage: false,
            supportsPlaybackPositionUpdates: false,
        };

        injector = Injector.create({
            providers: [
                PlaybackPositionRuntimeBridgeService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
            ],
        });

        service = runInInjectionContext(injector, () =>
            injector.get(PlaybackPositionRuntimeBridgeService)
        );
    });

    afterEach(() => {
        window.electron = originalElectron;
        injector.destroy();
        jest.restoreAllMocks();
    });

    it('does not call Electron playback-position methods when storage support is unavailable', async () => {
        const dbSavePlaybackPosition = jest.fn().mockResolvedValue({
            success: true,
        });
        const dbGetPlaybackPosition = jest.fn().mockResolvedValue(null);
        const dbGetSeriesPlaybackPositions = jest.fn().mockResolvedValue([]);
        const dbGetRecentPlaybackPositions = jest.fn().mockResolvedValue([]);
        const dbGetAllPlaybackPositions = jest.fn().mockResolvedValue([]);
        const dbClearAllPlaybackPositions = jest.fn().mockResolvedValue({
            success: true,
        });
        const dbClearPlaybackPosition = jest.fn().mockResolvedValue({
            success: true,
        });
        window.electron = {
            ...window.electron,
            dbSavePlaybackPosition,
            dbGetPlaybackPosition,
            dbGetSeriesPlaybackPositions,
            dbGetRecentPlaybackPositions,
            dbGetAllPlaybackPositions,
            dbClearAllPlaybackPositions,
            dbClearPlaybackPosition,
        } as unknown as typeof window.electron;

        const position = createPosition();

        await expect(
            service.savePlaybackPosition('playlist-1', position)
        ).resolves.toBeUndefined();
        await expect(
            service.getPlaybackPosition('playlist-1', 100, 'vod')
        ).resolves.toBeNull();
        await expect(
            service.getSeriesPlaybackPositions('playlist-1', 200)
        ).resolves.toEqual([]);
        await expect(
            service.getRecentPlaybackPositions('playlist-1', 5)
        ).resolves.toEqual([]);
        await expect(
            service.getAllPlaybackPositions('playlist-1')
        ).resolves.toEqual([]);
        await expect(
            service.clearAllPlaybackPositions('playlist-1')
        ).resolves.toBeUndefined();
        await expect(
            service.clearPlaybackPosition('playlist-1', 100, 'vod')
        ).resolves.toBeUndefined();

        expect(dbSavePlaybackPosition).not.toHaveBeenCalled();
        expect(dbGetPlaybackPosition).not.toHaveBeenCalled();
        expect(dbGetSeriesPlaybackPositions).not.toHaveBeenCalled();
        expect(dbGetRecentPlaybackPositions).not.toHaveBeenCalled();
        expect(dbGetAllPlaybackPositions).not.toHaveBeenCalled();
        expect(dbClearAllPlaybackPositions).not.toHaveBeenCalled();
        expect(dbClearPlaybackPosition).not.toHaveBeenCalled();
    });

    it('delegates storage calls through the typed Electron bridge when supported', async () => {
        const position = createPosition();
        const episodePosition = createPosition({
            contentXtreamId: 101,
            contentType: 'episode',
            seriesXtreamId: 200,
        });
        const dbSavePlaybackPosition = jest.fn().mockResolvedValue({
            success: true,
        });
        const dbGetPlaybackPosition = jest.fn().mockResolvedValue(position);
        const dbGetSeriesPlaybackPositions = jest
            .fn()
            .mockResolvedValue([episodePosition]);
        const dbGetRecentPlaybackPositions = jest
            .fn()
            .mockResolvedValue([position]);
        const dbGetAllPlaybackPositions = jest
            .fn()
            .mockResolvedValue([position, episodePosition]);
        const dbClearAllPlaybackPositions = jest.fn().mockResolvedValue({
            success: true,
        });
        const dbClearPlaybackPosition = jest.fn().mockResolvedValue({
            success: true,
        });
        window.electron = {
            ...window.electron,
            dbSavePlaybackPosition,
            dbGetPlaybackPosition,
            dbGetSeriesPlaybackPositions,
            dbGetRecentPlaybackPositions,
            dbGetAllPlaybackPositions,
            dbClearAllPlaybackPositions,
            dbClearPlaybackPosition,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsPlaybackPositionStorage = true;

        await service.savePlaybackPosition('playlist-1', position);
        await expect(
            service.getPlaybackPosition('playlist-1', 100, 'vod')
        ).resolves.toEqual(position);
        await expect(
            service.getSeriesPlaybackPositions('playlist-1', 200)
        ).resolves.toEqual([episodePosition]);
        await expect(
            service.getRecentPlaybackPositions('playlist-1', 5)
        ).resolves.toEqual([position]);
        await expect(
            service.getAllPlaybackPositions('playlist-1')
        ).resolves.toEqual([position, episodePosition]);
        await service.clearAllPlaybackPositions('playlist-1');
        await service.clearPlaybackPosition('playlist-1', 100, 'vod');

        expect(dbSavePlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            position
        );
        expect(dbGetPlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            100,
            'vod'
        );
        expect(dbGetSeriesPlaybackPositions).toHaveBeenCalledWith(
            'playlist-1',
            200
        );
        expect(dbGetRecentPlaybackPositions).toHaveBeenCalledWith(
            'playlist-1',
            5
        );
        expect(dbGetAllPlaybackPositions).toHaveBeenCalledWith('playlist-1');
        expect(dbClearAllPlaybackPositions).toHaveBeenCalledWith('playlist-1');
        expect(dbClearPlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            100,
            'vod'
        );
    });

    it('subscribes to playback-position updates only when update events are supported', () => {
        const unsubscribe = jest.fn();
        const onPlaybackPositionUpdate = jest.fn(() => unsubscribe);
        window.electron = {
            ...window.electron,
            onPlaybackPositionUpdate,
        } as unknown as typeof window.electron;

        const callback = jest.fn();

        expect(service.onPlaybackPositionUpdate(callback)).toBeUndefined();
        expect(onPlaybackPositionUpdate).not.toHaveBeenCalled();

        runtimeCapabilities.supportsPlaybackPositionUpdates = true;

        expect(service.onPlaybackPositionUpdate(callback)).toBe(unsubscribe);
        expect(onPlaybackPositionUpdate).toHaveBeenCalledWith(callback);
    });

    describe.each([
        {
            name: 'save',
            installBridge: (implementation: jest.Mock) => {
                window.electron = {
                    ...window.electron,
                    dbSavePlaybackPosition: implementation,
                } as unknown as typeof window.electron;
            },
            invokeLenient: (
                target: PlaybackPositionRuntimeBridgeService
            ) => target.savePlaybackPosition('playlist-1', createPosition()),
            invokeStrict: (
                target: PlaybackPositionRuntimeBridgeService
            ) =>
                target.savePlaybackPositionOrThrow(
                    'playlist-1',
                    createPosition()
                ),
        },
        {
            name: 'clear',
            installBridge: (implementation: jest.Mock) => {
                window.electron = {
                    ...window.electron,
                    dbClearPlaybackPosition: implementation,
                } as unknown as typeof window.electron;
            },
            invokeLenient: (
                target: PlaybackPositionRuntimeBridgeService
            ) =>
                target.clearPlaybackPosition(
                    'playlist-1',
                    100,
                    'vod'
                ),
            invokeStrict: (
                target: PlaybackPositionRuntimeBridgeService
            ) =>
                target.clearPlaybackPositionOrThrow(
                    'playlist-1',
                    100,
                    'vod'
                ),
        },
    ])('$name persistence', (operation) => {
        it('accepts only an explicit success result', async () => {
            runtimeCapabilities.supportsPlaybackPositionStorage = true;
            operation.installBridge(
                jest.fn().mockResolvedValue({ success: true })
            );

            await expect(operation.invokeStrict(service)).resolves.toBeUndefined();
        });

        it('propagates rejected IPC', async () => {
            const error = new Error('database is locked');
            runtimeCapabilities.supportsPlaybackPositionStorage = true;
            operation.installBridge(jest.fn().mockRejectedValue(error));

            await expect(operation.invokeStrict(service)).rejects.toBe(error);
        });

        it.each([{ success: false }, {}, undefined])(
            'rejects a non-success result %#',
            async (result) => {
                runtimeCapabilities.supportsPlaybackPositionStorage = true;
                operation.installBridge(jest.fn().mockResolvedValue(result));

                await expect(operation.invokeStrict(service)).rejects.toThrow(
                    'did not succeed'
                );
            }
        );

        it('rejects when the storage capability is unavailable', async () => {
            const bridgeMethod = jest
                .fn()
                .mockResolvedValue({ success: true });
            operation.installBridge(bridgeMethod);

            await expect(operation.invokeStrict(service)).rejects.toThrow(
                'storage is unavailable'
            );
            expect(bridgeMethod).not.toHaveBeenCalled();
        });

        it('rejects when the expected bridge method is unavailable', async () => {
            runtimeCapabilities.supportsPlaybackPositionStorage = true;

            await expect(operation.invokeStrict(service)).rejects.toThrow(
                'method is unavailable'
            );
        });

        it.each([{ success: false }, {}, undefined])(
            'ignores a non-success result through the lenient method %#',
            async (result) => {
                runtimeCapabilities.supportsPlaybackPositionStorage = true;
                operation.installBridge(jest.fn().mockResolvedValue(result));

                await expect(
                    operation.invokeLenient(service)
                ).resolves.toBeUndefined();
            }
        );

        it('resolves the lenient method when its bridge method is missing', async () => {
            runtimeCapabilities.supportsPlaybackPositionStorage = true;

            await expect(
                operation.invokeLenient(service)
            ).resolves.toBeUndefined();
        });

        it('propagates rejected IPC through the lenient method', async () => {
            const error = new Error('database is locked');
            runtimeCapabilities.supportsPlaybackPositionStorage = true;
            operation.installBridge(jest.fn().mockRejectedValue(error));

            await expect(operation.invokeLenient(service)).rejects.toBe(error);
        });
    });

    describe.each([
        {
            name: 'batch save',
            items: batchSaveItems as unknown[],
            installBridge: (implementation: jest.Mock) => {
                window.electron = {
                    ...window.electron,
                    dbSavePlaybackPositionsBatch: implementation,
                } as unknown as typeof window.electron;
            },
            invoke: (target: PlaybackPositionRuntimeBridgeService) =>
                target.savePlaybackPositionsBatch(
                    'playlist-1',
                    batchSaveItems
                ),
            invokeEmpty: (target: PlaybackPositionRuntimeBridgeService) =>
                target.savePlaybackPositionsBatch('playlist-1', []),
        },
        {
            name: 'batch clear',
            items: batchClearItems as unknown[],
            installBridge: (implementation: jest.Mock) => {
                window.electron = {
                    ...window.electron,
                    dbClearPlaybackPositionsBatch: implementation,
                } as unknown as typeof window.electron;
            },
            invoke: (target: PlaybackPositionRuntimeBridgeService) =>
                target.clearPlaybackPositionsBatch(
                    'playlist-1',
                    batchClearItems
                ),
            invokeEmpty: (target: PlaybackPositionRuntimeBridgeService) =>
                target.clearPlaybackPositionsBatch('playlist-1', []),
        },
    ])('$name persistence', (operation) => {
        it('silently no-ops when the storage capability is unavailable', async () => {
            const bridgeMethod = jest
                .fn()
                .mockResolvedValue({ success: true });
            operation.installBridge(bridgeMethod);

            await expect(operation.invoke(service)).resolves.toBeUndefined();
            expect(bridgeMethod).not.toHaveBeenCalled();
        });

        it('silently no-ops on an empty item list', async () => {
            runtimeCapabilities.supportsPlaybackPositionStorage = true;
            const bridgeMethod = jest
                .fn()
                .mockResolvedValue({ success: true });
            operation.installBridge(bridgeMethod);

            await expect(
                operation.invokeEmpty(service)
            ).resolves.toBeUndefined();
            expect(bridgeMethod).not.toHaveBeenCalled();
        });

        it('invokes the batch bridge method with the playlist and items', async () => {
            runtimeCapabilities.supportsPlaybackPositionStorage = true;
            const bridgeMethod = jest
                .fn()
                .mockResolvedValue({ success: true });
            operation.installBridge(bridgeMethod);

            await expect(operation.invoke(service)).resolves.toBeUndefined();
            expect(bridgeMethod).toHaveBeenCalledWith(
                'playlist-1',
                operation.items
            );
        });

        it.each([{ success: false }, {}, undefined])(
            'rejects a non-success result %#',
            async (result) => {
                runtimeCapabilities.supportsPlaybackPositionStorage = true;
                operation.installBridge(jest.fn().mockResolvedValue(result));

                await expect(operation.invoke(service)).rejects.toThrow(
                    'did not succeed'
                );
            }
        );

        it('rejects when the batch bridge method is unavailable', async () => {
            runtimeCapabilities.supportsPlaybackPositionStorage = true;

            await expect(operation.invoke(service)).rejects.toThrow(
                'method is unavailable'
            );
        });

        it('propagates rejected IPC', async () => {
            const error = new Error('database is locked');
            runtimeCapabilities.supportsPlaybackPositionStorage = true;
            operation.installBridge(jest.fn().mockRejectedValue(error));

            await expect(operation.invoke(service)).rejects.toBe(error);
        });
    });
});

function createPosition(
    overrides: Partial<PlaybackPositionData> = {}
): PlaybackPositionData {
    return {
        contentXtreamId: 100,
        contentType: 'vod',
        positionSeconds: 42,
        durationSeconds: 5400,
        playlistId: 'playlist-1',
        ...overrides,
    };
}
