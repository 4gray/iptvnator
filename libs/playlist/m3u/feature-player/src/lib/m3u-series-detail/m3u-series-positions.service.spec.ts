import { TestBed } from '@angular/core/testing';
import {
    PlaybackPositionRuntimeBridgeService,
    PlaybackPositionService,
} from '@iptvnator/services';
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
        savePlaybackPositionsBatch: jest.fn(),
        clearPlaybackPositionsBatch: jest.fn(),
    };

    let service: M3uSeriesPositionsService;

    beforeEach(() => {
        bridge.getSeriesPlaybackPositions.mockReset().mockResolvedValue([]);
        bridge.savePlaybackPosition.mockReset().mockResolvedValue(undefined);
        bridge.clearPlaybackPosition.mockReset().mockResolvedValue(undefined);
        bridge.savePlaybackPositionsBatch
            .mockReset()
            .mockResolvedValue(undefined);
        bridge.clearPlaybackPositionsBatch
            .mockReset()
            .mockResolvedValue(undefined);

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

    it('says when a read is still in flight', async () => {
        let deliver: (rows: PlaybackPositionData[]) => void = () => undefined;
        bridge.getSeriesPlaybackPositions.mockReturnValue(
            new Promise<PlaybackPositionData[]>((resolve) => {
                deliver = resolve;
            })
        );

        const load = service.load('pl-1', 500);
        const pending = service.whenLoaded();
        expect(pending).not.toBeNull();

        deliver([position(11, 60)]);
        await load;
        await pending;

        expect(service.whenLoaded()).toBeNull();
        expect(service.byEpisodeId().get(11)?.positionSeconds).toBe(60);
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

    describe('the tick the throttle held back', () => {
        let nowSpy: jest.SpyInstance<number, []>;
        const saved = () =>
            bridge.savePlaybackPosition.mock.calls.map(
                ([, row]: [string, PlaybackPositionData]) => [
                    row.contentXtreamId,
                    row.positionSeconds,
                ]
            );

        beforeEach(async () => {
            nowSpy = jest.spyOn(Date, 'now').mockReturnValue(3_000_000);
            await service.load('pl-1', 500);
            await service.recordProgress('pl-1', position(11, 10));
            nowSpy.mockReturnValue(3_005_000);
            await service.recordProgress('pl-1', position(11, 15));
        });

        afterEach(() => nowSpy.mockRestore());

        it('is saved when the player closes', async () => {
            service.releaseProgressThrottle();
            await Promise.resolve();

            expect(saved()).toEqual([
                [11, 10],
                [11, 15],
            ]);
        });

        it('is saved before another episode starts', async () => {
            await service.recordProgress('pl-1', position(12, 1));

            expect(saved()).toEqual([
                [11, 10],
                [11, 15],
                [12, 1],
            ]);
        });

        it('is saved when the page goes away', async () => {
            service.ngOnDestroy();
            await Promise.resolve();

            expect(saved()).toEqual([
                [11, 10],
                [11, 15],
            ]);
        });

        it('is saved when another series opens', async () => {
            await service.load('pl-1', 600);

            expect(saved()).toEqual([
                [11, 10],
                [11, 15],
            ]);
        });

        it('is dropped when its episode is toggled, so it cannot undo the toggle', async () => {
            bridge.savePlaybackPosition.mockClear();

            await service.applyToggle('pl-1', 500, {
                contentXtreamId: 11,
                nextPosition: position(11, 1200),
            } as never);

            // The 15 s tick is older than the decision; the reload after the
            // batch would otherwise write it over the watched mark.
            expect(saved()).toEqual([]);
            expect(bridge.savePlaybackPositionsBatch).toHaveBeenCalledTimes(1);
        });

        it('is written before a toggle of another episode', async () => {
            bridge.savePlaybackPosition.mockClear();
            const order: string[] = [];
            bridge.savePlaybackPosition.mockImplementation(async () => {
                order.push('tick');
            });
            bridge.clearPlaybackPositionsBatch.mockImplementation(async () => {
                order.push('batch');
            });

            await service.applyToggle('pl-1', 500, {
                contentXtreamId: 12,
                nextPosition: null,
            } as never);

            expect(saved()).toEqual([[11, 15]]);
            expect(order).toEqual(['tick', 'batch']);
        });

        it('is written once, not again on the next flush', async () => {
            service.releaseProgressThrottle();
            service.releaseProgressThrottle();
            await Promise.resolve();

            expect(saved()).toHaveLength(2);
        });
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

        // One batch per direction, not one awaited IPC per episode.
        expect(bridge.savePlaybackPositionsBatch).toHaveBeenCalledWith('pl-1', [
            expect.objectContaining({ contentXtreamId: 11 }),
        ]);
        expect(bridge.clearPlaybackPositionsBatch).toHaveBeenCalledWith(
            'pl-1',
            [{ contentXtreamId: 12, contentType: 'episode' }]
        );
        expect(bridge.savePlaybackPosition).not.toHaveBeenCalled();
        expect(bridge.clearPlaybackPosition).not.toHaveBeenCalled();
    });

    it('leaves the page to a series opened while a toggle was writing', async () => {
        await service.load('pl-1', 500);
        let finishWrite: () => void = () => undefined;
        bridge.savePlaybackPositionsBatch.mockReturnValue(
            new Promise<void>((resolve) => {
                finishWrite = resolve;
            })
        );

        const toggle = service.applyToggle('pl-1', 500, {
            markWatched: true,
            requests: [
                { contentXtreamId: 11, nextPosition: position(11, 1200) },
            ],
        });
        await Promise.resolve();
        await service.load('pl-1', 600);
        bridge.getSeriesPlaybackPositions.mockClear();
        finishWrite();
        await toggle;

        // Series 500 must not take the page back: no reload of it, and a
        // tick of series 600 is still recorded.
        expect(bridge.getSeriesPlaybackPositions).not.toHaveBeenCalled();
        await service.recordProgress('pl-1', {
            ...position(21, 30),
            seriesXtreamId: 600,
        });
        expect(service.byEpisodeId().get(21)?.positionSeconds).toBe(30);
    });

    it('reports a season batch as running until it has been persisted', async () => {
        await service.load('pl-1', 500);
        let finishWrite: () => void = () => undefined;
        bridge.savePlaybackPositionsBatch.mockReturnValue(
            new Promise<void>((resolve) => {
                finishWrite = resolve;
            })
        );

        const toggle = service.applyToggle('pl-1', 500, {
            markWatched: true,
            requests: [
                { contentXtreamId: 11, nextPosition: position(11, 1200) },
            ],
        });
        expect(service.toggleRunning()).toBe(true);

        finishWrite();
        await toggle;
        expect(service.toggleRunning()).toBe(false);

        // One episode's toggle is a single row and holds nothing back.
        const single = service.applyToggle('pl-1', 500, {
            contentXtreamId: 11,
            nextPosition: null,
        });
        expect(service.toggleRunning()).toBe(false);
        await single;
    });

    it('still reloads when a batch write is refused', async () => {
        await service.load('pl-1', 500);
        bridge.getSeriesPlaybackPositions.mockClear();
        bridge.savePlaybackPositionsBatch.mockRejectedValue(
            new Error('db gone')
        );

        await expect(
            service.applyToggle('pl-1', 500, {
                contentXtreamId: 11,
                nextPosition: position(11, 1200),
            })
        ).resolves.toBeUndefined();
        expect(bridge.getSeriesPlaybackPositions).toHaveBeenCalledWith(
            'pl-1',
            500
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

    it('keeps the series now open when an older read lands late', async () => {
        // Navigating between series leaves the first read in the worker;
        // the slower one must not paint the previous show's progress.
        let deliverFirst: (rows: PlaybackPositionData[]) => void = () =>
            undefined;
        bridge.getSeriesPlaybackPositions
            .mockReturnValueOnce(
                new Promise<PlaybackPositionData[]>((resolve) => {
                    deliverFirst = resolve;
                })
            )
            .mockResolvedValueOnce([position(21, 90)]);

        const first = service.load('pl-1', 500);
        await service.load('pl-1', 999);
        deliverFirst([position(11, 60)]);
        await first;

        expect(service.byEpisodeId().has(11)).toBe(false);
        expect(service.byEpisodeId().get(21)?.positionSeconds).toBe(90);
    });

    it('stops reporting a read in flight once that read has rejected', async () => {
        // The position service swallows IPC failures today; should a read
        // ever reject, an episode click waiting on it must not hang.
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                M3uSeriesPositionsService,
                {
                    provide: PlaybackPositionService,
                    useValue: {
                        getSeriesPlaybackPositions: jest
                            .fn()
                            .mockRejectedValue(new Error('db gone')),
                    },
                },
            ],
        });
        const failing = TestBed.inject(M3uSeriesPositionsService);

        const load = failing.load('pl-1', 500);
        const pending = failing.whenLoaded();

        await expect(load).rejects.toThrow('db gone');
        await expect(pending).resolves.toBeUndefined();
        expect(failing.whenLoaded()).toBeNull();
    });

    it('files a tick that names no series under the page that has none', async () => {
        await service.load('pl-1', 0);

        await service.recordProgress('pl-1', {
            ...position(11, 42),
            seriesXtreamId: undefined,
        });

        expect(service.byEpisodeId().get(11)?.positionSeconds).toBe(42);
        expect(bridge.savePlaybackPosition).toHaveBeenCalledTimes(1);
    });
});
