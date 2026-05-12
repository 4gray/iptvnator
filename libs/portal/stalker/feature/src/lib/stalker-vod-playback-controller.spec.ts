import { signal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import type {
    Logger,
    PortalPlaybackPositions,
    PortalPlayer,
} from '@iptvnator/portal/shared/util';
import type { PlaybackPositionData } from 'shared-interfaces';
import { StalkerVodPlaybackController } from './stalker-vod-playback-controller';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolver) => {
        resolve = resolver;
    });

    return {
        promise,
        resolve,
    };
}

function createPosition(
    contentXtreamId: number,
    positionSeconds: number
): PlaybackPositionData {
    return {
        contentXtreamId,
        contentType: 'vod',
        positionSeconds,
        durationSeconds: 100,
    };
}

function createController() {
    const inlinePlayback = signal(null);
    const selectedVodPosition = signal<PlaybackPositionData | null>(null);
    const playbackPositions = {
        savePlaybackPosition: jest.fn(),
        getPlaybackPosition: jest.fn(),
        getSeriesPlaybackPositions: jest.fn(),
        getAllPlaybackPositions: jest.fn(),
        clearPlaybackPosition: jest.fn(),
    } as unknown as jest.Mocked<PortalPlaybackPositions>;
    const portalPlayer = {
        isEmbeddedPlayer: jest.fn(() => true),
        openPlayer: jest.fn(),
        openResolvedPlayback: jest.fn(),
        openExternalPlayback: jest.fn(),
    } as unknown as jest.Mocked<PortalPlayer>;
    const snackBar = {
        open: jest.fn(),
    } as unknown as MatSnackBar;
    const translateService = {
        instant: jest.fn((key: string) => key),
    } as unknown as TranslateService;
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    } as unknown as Logger;

    const controller = new StalkerVodPlaybackController({
        inlinePlayback,
        selectedVodPosition,
        playbackPositions,
        portalPlayer,
        snackBar,
        translateService,
        logger,
        playbackErrorLogMessage: 'Playback failed',
    });

    return {
        controller,
        playbackPositions,
        selectedVodPosition,
    };
}

describe('StalkerVodPlaybackController', () => {
    it('ignores stale VOD position loads that resolve after a newer selection', async () => {
        const { controller, playbackPositions, selectedVodPosition } =
            createController();
        const olderLoad = createDeferred<PlaybackPositionData | null>();
        const newerLoad = createDeferred<PlaybackPositionData | null>();

        playbackPositions.getPlaybackPosition.mockImplementation(
            (_playlistId, vodId) =>
                vodId === 101 ? olderLoad.promise : newerLoad.promise
        );

        const olderLoadPromise = controller.loadSelectedVodPosition(
            'playlist-1',
            101
        );
        const newerLoadPromise = controller.loadSelectedVodPosition(
            'playlist-1',
            202
        );

        newerLoad.resolve(createPosition(202, 20));
        await newerLoadPromise;
        expect(selectedVodPosition()?.contentXtreamId).toBe(202);

        olderLoad.resolve(createPosition(101, 10));
        await olderLoadPromise;
        expect(selectedVodPosition()?.contentXtreamId).toBe(202);
        expect(selectedVodPosition()?.positionSeconds).toBe(20);
    });
});
