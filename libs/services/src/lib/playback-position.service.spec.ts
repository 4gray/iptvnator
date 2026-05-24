import {
    DestroyableInjector,
    Injector,
    runInInjectionContext,
} from '@angular/core';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { PlaybackPositionRuntimeBridgeService } from './playback-position-runtime-bridge.service';
import { PlaybackPositionService } from './playback-position.service';

describe('PlaybackPositionService', () => {
    let service: PlaybackPositionService;
    let injector: DestroyableInjector;
    let bridge: jest.Mocked<
        Pick<
            PlaybackPositionRuntimeBridgeService,
            | 'savePlaybackPosition'
            | 'getPlaybackPosition'
            | 'getSeriesPlaybackPositions'
            | 'getRecentPlaybackPositions'
            | 'getAllPlaybackPositions'
            | 'clearAllPlaybackPositions'
            | 'clearPlaybackPosition'
        >
    >;

    beforeEach(() => {
        bridge = {
            savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
            getPlaybackPosition: jest.fn().mockResolvedValue(null),
            getSeriesPlaybackPositions: jest.fn().mockResolvedValue([]),
            getRecentPlaybackPositions: jest.fn().mockResolvedValue([]),
            getAllPlaybackPositions: jest.fn().mockResolvedValue([]),
            clearAllPlaybackPositions: jest.fn().mockResolvedValue(undefined),
            clearPlaybackPosition: jest.fn().mockResolvedValue(undefined),
        };

        injector = Injector.create({
            providers: [
                PlaybackPositionService,
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: bridge,
                },
            ],
        });

        service = runInInjectionContext(injector, () =>
            injector.get(PlaybackPositionService)
        );
    });

    afterEach(() => {
        injector.destroy();
        jest.restoreAllMocks();
    });

    it('delegates playback-position storage through the runtime bridge', async () => {
        const position = createPosition();

        bridge.getPlaybackPosition.mockResolvedValue(position);
        bridge.getSeriesPlaybackPositions.mockResolvedValue([position]);
        bridge.getRecentPlaybackPositions.mockResolvedValue([position]);
        bridge.getAllPlaybackPositions.mockResolvedValue([position]);

        await service.savePlaybackPosition('playlist-1', position);
        await expect(
            service.getPlaybackPosition('playlist-1', 100, 'vod')
        ).resolves.toEqual(position);
        await expect(
            service.getSeriesPlaybackPositions('playlist-1', 200)
        ).resolves.toEqual([position]);
        await expect(
            service.getRecentPlaybackPositions('playlist-1', 5)
        ).resolves.toEqual([position]);
        await expect(
            service.getAllPlaybackPositions('playlist-1')
        ).resolves.toEqual([position]);
        await service.clearAllPlaybackPositions('playlist-1');
        await service.clearPlaybackPosition('playlist-1', 100, 'vod');

        expect(bridge.savePlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            position
        );
        expect(bridge.getPlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            100,
            'vod'
        );
        expect(bridge.getSeriesPlaybackPositions).toHaveBeenCalledWith(
            'playlist-1',
            200
        );
        expect(bridge.getRecentPlaybackPositions).toHaveBeenCalledWith(
            'playlist-1',
            5
        );
        expect(bridge.getAllPlaybackPositions).toHaveBeenCalledWith(
            'playlist-1'
        );
        expect(bridge.clearAllPlaybackPositions).toHaveBeenCalledWith(
            'playlist-1'
        );
        expect(bridge.clearPlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            100,
            'vod'
        );
    });

    it('preserves fallback values when the runtime bridge rejects', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        bridge.savePlaybackPosition.mockRejectedValue(new Error('save failed'));
        bridge.getPlaybackPosition.mockRejectedValue(new Error('get failed'));
        bridge.getSeriesPlaybackPositions.mockRejectedValue(
            new Error('series failed')
        );
        bridge.getRecentPlaybackPositions.mockRejectedValue(
            new Error('recent failed')
        );
        bridge.getAllPlaybackPositions.mockRejectedValue(
            new Error('all failed')
        );
        bridge.clearAllPlaybackPositions.mockRejectedValue(
            new Error('clear all failed')
        );
        bridge.clearPlaybackPosition.mockRejectedValue(
            new Error('clear one failed')
        );

        await expect(
            service.savePlaybackPosition('playlist-1', createPosition())
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
