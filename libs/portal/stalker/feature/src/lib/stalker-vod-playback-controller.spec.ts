import { signal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import type {
    Logger,
    PortalPlaybackPositions,
    PortalPlayer,
} from '@iptvnator/portal/shared/util';
import type {
    PlaybackPositionData,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
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

function createController(playbackOwnerKey?: () => string) {
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
        playbackOwnerKey,
    });

    return {
        controller,
        inlinePlayback,
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

    it('does not hold a reopened movie with a start its earlier visit left pending', () => {
        let owner = 'movie-a';
        const { controller } = createController(() => owner);
        const pending = controller.beginPendingStart();
        expect(controller.playbackStartPending()).toBe(true);

        // Back out of the movie while the portal request hangs, then
        // reopen it: the new visit must be playable.
        owner = '';
        controller.retirePendingStart('movie-a');
        owner = 'movie-a';
        expect(controller.playbackStartPending()).toBe(false);
        expect(pending.isCurrent()).toBe(true);

        pending.settle();
        expect(controller.playbackStartPending()).toBe(false);
    });

    it('does not mount playback that resolves after the detail closes', async () => {
        const { controller, inlinePlayback } = createController();
        const pending = createDeferred<ResolvedPortalPlayback>();
        const playback = controller.startVodPlayback(() => pending.promise);

        controller.closeInlinePlayer();
        pending.resolve({
            streamUrl: 'https://stale.example/movie.mpg',
            title: 'Stale movie',
        });
        await playback;

        expect(inlinePlayback()).toBeNull();
    });

    it('keeps the newest VOD request when resolutions finish out of order', async () => {
        const { controller, inlinePlayback } = createController();
        const older = createDeferred<ResolvedPortalPlayback>();
        const newer = createDeferred<ResolvedPortalPlayback>();
        const olderRequest = controller.startVodPlayback(() => older.promise);
        const newerRequest = controller.startVodPlayback(() => newer.promise);
        const newestPlayback = {
            streamUrl: 'https://new.example/movie.mpg',
            title: 'Newest movie',
        };

        newer.resolve(newestPlayback);
        older.resolve({
            streamUrl: 'https://old.example/movie.mpg',
            title: 'Old movie',
        });
        await Promise.all([olderRequest, newerRequest]);

        expect(inlinePlayback()).toBe(newestPlayback);
    });
});
