import {
    DestroyableInjector,
    Injector,
    runInInjectionContext,
} from '@angular/core';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';
import { PlaybackPositionRuntimeBridgeService } from './playback-position-runtime-bridge.service';

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
