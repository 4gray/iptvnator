import { TestBed } from '@angular/core/testing';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';

const position = (
    episodeId: number,
    seconds: number
): PlaybackPositionData => ({
    contentXtreamId: episodeId,
    contentType: 'episode',
    seriesXtreamId: 500,
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: seconds,
});

describe('M3uSeriesPositionsService', () => {
    const bridge = {
        getSeriesPlaybackPositions: jest.fn(),
        savePlaybackPosition: jest.fn(),
        clearPlaybackPosition: jest.fn(),
    };

    let service: M3uSeriesPositionsService;

    beforeEach(() => {
        bridge.getSeriesPlaybackPositions.mockReset().mockResolvedValue([]);
        bridge.savePlaybackPosition.mockReset().mockResolvedValue(undefined);
        bridge.clearPlaybackPosition.mockReset().mockResolvedValue(undefined);

        TestBed.configureTestingModule({
            providers: [
                M3uSeriesPositionsService,
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: bridge,
                },
            ],
        });
        service = TestBed.inject(M3uSeriesPositionsService);
    });

    it('indexes loaded rows by episode id', async () => {
        bridge.getSeriesPlaybackPositions.mockResolvedValue([
            position(11, 60),
            position(12, 90),
        ]);

        await service.load('pl-1', 500);

        expect(service.byEpisodeId().get(11)?.positionSeconds).toBe(60);
        expect(service.byEpisodeId().get(12)?.positionSeconds).toBe(90);
    });

    it('asks for nothing without a playlist or series', async () => {
        await service.load('', 500);
        await service.load('pl-1', 0);

        expect(bridge.getSeriesPlaybackPositions).not.toHaveBeenCalled();
        expect(service.byEpisodeId().size).toBe(0);
    });

    it('reflects a progress tick before the write settles', async () => {
        await service.load('pl-1', 500);
        // The grid should follow the player without waiting on storage; a
        // slow write must not make progress look lost.
        let release: (() => void) | undefined;
        bridge.savePlaybackPosition.mockReturnValue(
            new Promise<void>((resolve) => {
                release = () => resolve();
            })
        );

        const pending = service.recordProgress('pl-1', position(11, 42));

        expect(service.byEpisodeId().get(11)?.positionSeconds).toBe(42);
        release?.();
        await pending;
    });

    it('writes a playing episode at most once per throttle window', async () => {
        // `timeupdate` fires about four times a second. Writing each one
        // queues thousands of SQLite round-trips over a single episode.
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
        try {
            await service.load('pl-1', 500);

            await service.recordProgress('pl-1', position(11, 10));
            await service.recordProgress('pl-1', position(11, 12));
            nowSpy.mockReturnValue(1_010_000);
            await service.recordProgress('pl-1', position(11, 20));

            expect(bridge.savePlaybackPosition).toHaveBeenCalledTimes(1);

            // The grid still follows every tick; only storage is coalesced.
            expect(service.byEpisodeId().get(11)?.positionSeconds).toBe(20);

            nowSpy.mockReturnValue(1_020_000);
            await service.recordProgress('pl-1', position(11, 30));

            expect(bridge.savePlaybackPosition).toHaveBeenCalledTimes(2);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('writes immediately when the tick belongs to another episode', async () => {
        // Otherwise the episode just left loses the offset it stopped at,
        // because the next one's window is still open.
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
        try {
            await service.load('pl-1', 500);

            await service.recordProgress('pl-1', position(11, 10));
            await service.recordProgress('pl-1', position(12, 5));

            expect(bridge.savePlaybackPosition).toHaveBeenCalledTimes(2);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('survives a failing write instead of rejecting into the caller', async () => {
        // Every caller starts these promises with `void`, from an effect or
        // a media time update, so a rejection would surface as an unhandled
        // rejection rather than as a skipped save.
        bridge.savePlaybackPosition.mockRejectedValue(new Error('db gone'));
        await service.load('pl-1', 500);

        await expect(
            service.recordProgress('pl-1', position(11, 42))
        ).resolves.toBeUndefined();
    });

    it('survives a failing read instead of rejecting into the caller', async () => {
        bridge.getSeriesPlaybackPositions.mockRejectedValue(
            new Error('db gone')
        );

        await expect(service.load('pl-1', 500)).resolves.toBeUndefined();
        expect(service.byEpisodeId().size).toBe(0);
    });

    it('saves a watched toggle and clears an unwatched one', async () => {
        await service.load('pl-1', 500);
        bridge.getSeriesPlaybackPositions.mockClear();
        await service.applyToggle('pl-1', 500, {
            markWatched: true,
            requests: [
                { contentXtreamId: 11, nextPosition: position(11, 1200) },
                { contentXtreamId: 12, nextPosition: null },
            ],
        });

        expect(bridge.savePlaybackPosition).toHaveBeenCalledWith(
            'pl-1',
            expect.objectContaining({ contentXtreamId: 11 })
        );
        expect(bridge.clearPlaybackPosition).toHaveBeenCalledWith(
            'pl-1',
            12,
            'episode'
        );
    });

    it('reloads after a toggle rather than trusting the local patch', async () => {
        await service.load('pl-1', 500);
        bridge.getSeriesPlaybackPositions.mockClear();
        // A single failed write would otherwise leave the grid claiming a
        // state that storage does not have.
        await service.applyToggle('pl-1', 500, {
            contentXtreamId: 11,
            nextPosition: position(11, 1200),
        });

        expect(bridge.getSeriesPlaybackPositions).toHaveBeenCalledWith(
            'pl-1',
            500
        );
    });

    it('ignores work for a series it no longer owns', async () => {
        // A progress tick from the player the viewer navigated away from
        // must not patch the series now on screen.
        await service.load('pl-1', 500);
        await service.load('pl-1', 999);

        await service.recordProgress('pl-1', position(11, 42));

        expect(service.byEpisodeId().has(11)).toBe(false);
        expect(bridge.savePlaybackPosition).not.toHaveBeenCalled();
    });

    it('does nothing without a playlist', async () => {
        await service.recordProgress('', position(11, 42));
        await service.applyToggle('', 500, {
            contentXtreamId: 11,
            nextPosition: null,
        });

        expect(bridge.savePlaybackPosition).not.toHaveBeenCalled();
        expect(bridge.clearPlaybackPosition).not.toHaveBeenCalled();
    });

    it('renders empty where storage is unavailable', async () => {
        // The PWA path: the bridge resolves empty rather than failing, so
        // the season grid shows no watched marks and nothing breaks.
        bridge.getSeriesPlaybackPositions.mockResolvedValue([]);

        await service.load('pl-1', 500);

        expect(service.byEpisodeId().size).toBe(0);
    });
});
