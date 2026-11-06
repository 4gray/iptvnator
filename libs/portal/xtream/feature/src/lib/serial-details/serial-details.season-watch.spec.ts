import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SerialDetailsComponent } from './serial-details.component';
import { SerialDetailsPlaybackService } from './serial-details-playback.service';
import {
    configureSerialDetailsTestBed,
    createSerialDetailsStubs,
    resetSerialDetailsStubs,
} from './serial-details.harness';

describe('SerialDetailsComponent watched toggles', () => {
    let fixture: ComponentFixture<SerialDetailsComponent>;
    const stubs = createSerialDetailsStubs();
    const {
        currentPlaylist,
        savePlaybackPosition,
        clearPlaybackPosition,
        savePlaybackPositionsBatch,
        clearPlaybackPositionsBatch,
        loadAllPositions,
    } = stubs;

    beforeEach(async () => {
        window.history.replaceState({}, '', window.location.href);
        resetSerialDetailsStubs(stubs);
        await configureSerialDetailsTestBed(stubs);

        fixture = TestBed.createComponent(SerialDetailsComponent);
    });

    afterEach(() => {
        window.history.replaceState({}, '', window.location.href);
        fixture?.destroy();
    });

    it('saves and clears positions for season-container toggle requests', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        await playbackService.handlePlaybackToggleRequested({
            contentXtreamId: 1001,
            nextPosition: {
                playlistId: 'xtream-1',
                contentXtreamId: 1001,
                contentType: 'episode',
                seriesXtreamId: 103,
                seasonNumber: 1,
                episodeNumber: 1,
                positionSeconds: 950,
                durationSeconds: 1000,
            },
        } as never);
        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({ contentXtreamId: 1001 })
        );

        await playbackService.handlePlaybackToggleRequested({
            contentXtreamId: 1001,
            nextPosition: null,
        } as never);
        expect(clearPlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            1001,
            'episode'
        );
    });

    it('marks a season watched through one batch save and updates rendered positions', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        const snackBar = TestBed.inject(MatSnackBar);
        const seasonPosition = (
            contentXtreamId: number,
            episodeNumber: number
        ) => ({
            playlistId: 'xtream-1',
            contentXtreamId,
            contentType: 'episode' as const,
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber,
            positionSeconds: 1200,
            durationSeconds: 1200,
        });

        await playbackService.handleWatchToggleRequested(
            {
                seasonKey: '1',
                markWatched: true,
                requests: [
                    {
                        contentXtreamId: 1001,
                        nextPosition: seasonPosition(1001, 1),
                    },
                    {
                        contentXtreamId: 1002,
                        nextPosition: seasonPosition(1002, 2),
                    },
                ],
            } as never,
            'season'
        );

        expect(savePlaybackPositionsBatch).toHaveBeenCalledTimes(1);
        expect(savePlaybackPositionsBatch).toHaveBeenCalledWith('xtream-1', [
            expect.objectContaining({ contentXtreamId: 1001 }),
            expect.objectContaining({ contentXtreamId: 1002 }),
        ]);
        expect(savePlaybackPosition).not.toHaveBeenCalled();
        expect(playbackService.episodePlaybackPositions().get(1001)).toEqual(
            expect.objectContaining({ positionSeconds: 1200 })
        );
        expect(
            playbackService.episodePlaybackPositions().get(1002)
        ).toBeDefined();
        expect(snackBar.open).toHaveBeenCalledWith(
            'XTREAM.SEASON_MARKED_WATCHED',
            undefined,
            { duration: 5000 }
        );
        // The catalog badge source must follow the batch.
        expect(loadAllPositions).toHaveBeenCalledWith('xtream-1');
        expect(playbackService.seasonWatchBatchRunning()).toBe(false);
    });

    it('unwatches a season through one batch clear', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        await playbackService.handleWatchToggleRequested(
            {
                seasonKey: '1',
                markWatched: false,
                requests: [
                    { contentXtreamId: 1001, nextPosition: null },
                    { contentXtreamId: 1002, nextPosition: null },
                ],
            } as never,
            'season'
        );

        expect(clearPlaybackPositionsBatch).toHaveBeenCalledTimes(1);
        expect(clearPlaybackPositionsBatch).toHaveBeenCalledWith('xtream-1', [
            { contentXtreamId: 1001, contentType: 'episode' },
            { contentXtreamId: 1002, contentType: 'episode' },
        ]);
        expect(clearPlaybackPosition).not.toHaveBeenCalled();
        expect(playbackService.episodePlaybackPositions().has(1001)).toBe(
            false
        );
    });

    it('does not write a stale season batch into another playlist state', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        let resolveBatch!: () => void;
        savePlaybackPositionsBatch.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveBatch = resolve;
                })
        );
        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        const pending = playbackService.handleWatchToggleRequested(
            {
                seasonKey: '1',
                markWatched: true,
                requests: [
                    {
                        contentXtreamId: 1001,
                        nextPosition: {
                            playlistId: 'xtream-1',
                            contentXtreamId: 1001,
                            contentType: 'episode',
                            seriesXtreamId: 103,
                            seasonNumber: 1,
                            episodeNumber: 1,
                            positionSeconds: 1200,
                            durationSeconds: 1200,
                        },
                    },
                ],
            } as never,
            'season'
        );

        // The user navigates to another playlist while the batch is pending.
        const initialPlaylist = currentPlaylist();
        currentPlaylist.set({ ...initialPlaylist, id: 'xtream-2' });
        resolveBatch();
        await pending;

        expect(savePlaybackPositionsBatch).toHaveBeenCalledWith(
            'xtream-1',
            expect.anything()
        );
        expect(playbackService.episodePlaybackPositions().has(1001)).toBe(
            false
        );
        expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
        // The store now belongs to the other playlist — no stale refresh.
        expect(loadAllPositions).not.toHaveBeenCalled();
        expect(playbackService.seasonWatchBatchRunning()).toBe(false);
        currentPlaylist.set(initialPlaylist);
    });

    it('keeps rendered positions and reports the error when the season batch fails', async () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        savePlaybackPositionsBatch.mockRejectedValue(new Error('batch failed'));
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        const snackBar = TestBed.inject(MatSnackBar);
        await playbackService.handleWatchToggleRequested(
            {
                seasonKey: '1',
                markWatched: true,
                requests: [
                    {
                        contentXtreamId: 1001,
                        nextPosition: {
                            playlistId: 'xtream-1',
                            contentXtreamId: 1001,
                            contentType: 'episode',
                            seriesXtreamId: 103,
                            seasonNumber: 1,
                            episodeNumber: 1,
                            positionSeconds: 1200,
                            durationSeconds: 1200,
                        },
                    },
                ],
            } as never,
            'season'
        );

        expect(playbackService.episodePlaybackPositions().has(1001)).toBe(
            false
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'XTREAM.SEASON_WATCH_UPDATE_FAILED',
            undefined,
            { duration: 5000 }
        );
        expect(playbackService.seasonWatchBatchRunning()).toBe(false);
        consoleError.mockRestore();
    });
});
