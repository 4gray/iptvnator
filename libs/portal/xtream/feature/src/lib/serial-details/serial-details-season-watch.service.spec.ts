import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { SerialDetailsSeasonWatchService } from './serial-details-season-watch.service';

describe('SerialDetailsSeasonWatchService', () => {
    let service: SerialDetailsSeasonWatchService;
    const savePlaybackPositionsBatch = jest.fn();
    const clearPlaybackPositionsBatch = jest.fn();
    const snackBarOpen = jest.fn();
    const state = { updateMany: jest.fn(), removeMany: jest.fn() };

    const position = (contentXtreamId: number): PlaybackPositionData => ({
        contentXtreamId,
        contentType: 'episode',
        seriesXtreamId: 20,
        seasonNumber: 1,
        episodeNumber: contentXtreamId % 100,
        positionSeconds: 2700,
        durationSeconds: 2700,
        playlistId: 'playlist-1',
    });

    const markRequest = (ids: number[]) => ({
        markWatched: true,
        requests: ids.map((id) => ({
            contentXtreamId: id,
            nextPosition: position(id),
        })),
    });

    const clearRequest = (ids: number[]) => ({
        markWatched: false,
        requests: ids.map((id) => ({
            contentXtreamId: id,
            nextPosition: null,
        })),
    });

    beforeEach(() => {
        jest.clearAllMocks();
        savePlaybackPositionsBatch.mockResolvedValue(undefined);
        clearPlaybackPositionsBatch.mockResolvedValue(undefined);
        TestBed.configureTestingModule({
            providers: [
                SerialDetailsSeasonWatchService,
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        savePlaybackPositionsBatch,
                        clearPlaybackPositionsBatch,
                    },
                },
                { provide: MatSnackBar, useValue: { open: snackBarOpen } },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string, params?: object) =>
                            params ? `${key}:${JSON.stringify(params)}` : key,
                    },
                },
            ],
        });
        service = TestBed.inject(SerialDetailsSeasonWatchService);
    });

    it('marks a season through one batch save with season feedback', async () => {
        const persisted = await service.handle(
            markRequest([101, 102]),
            'playlist-1',
            state,
            () => true,
            'season'
        );

        expect(persisted).toBe(true);
        expect(savePlaybackPositionsBatch).toHaveBeenCalledWith('playlist-1', [
            expect.objectContaining({ contentXtreamId: 101 }),
            expect.objectContaining({ contentXtreamId: 102 }),
        ]);
        expect(state.updateMany).toHaveBeenCalledTimes(1);
        expect(snackBarOpen).toHaveBeenCalledWith(
            'XTREAM.SEASON_MARKED_WATCHED:{"count":2}',
            undefined,
            { duration: 5000 }
        );
    });

    it('reuses the scope-generic marked key for a series mark', async () => {
        await service.handle(
            markRequest([101, 201]),
            'playlist-1',
            state,
            () => true,
            'series'
        );

        expect(snackBarOpen).toHaveBeenCalledWith(
            'XTREAM.SEASON_MARKED_WATCHED:{"count":2}',
            undefined,
            { duration: 5000 }
        );
    });

    it('unmarks a series through one batch clear with series feedback', async () => {
        const persisted = await service.handle(
            clearRequest([101, 201]),
            'playlist-1',
            state,
            () => true,
            'series'
        );

        expect(persisted).toBe(true);
        expect(clearPlaybackPositionsBatch).toHaveBeenCalledWith(
            'playlist-1',
            [
                { contentXtreamId: 101, contentType: 'episode' },
                { contentXtreamId: 201, contentType: 'episode' },
            ]
        );
        expect(state.removeMany).toHaveBeenCalledWith([101, 201]);
        expect(snackBarOpen).toHaveBeenCalledWith(
            'XTREAM.SERIES_MARKED_UNWATCHED',
            undefined,
            { duration: 5000 }
        );
    });

    it('keeps the season unmark feedback on the season scope', async () => {
        await service.handle(
            clearRequest([101]),
            'playlist-1',
            state,
            () => true,
            'season'
        );

        expect(snackBarOpen).toHaveBeenCalledWith(
            'XTREAM.SEASON_MARKED_UNWATCHED',
            undefined,
            { duration: 5000 }
        );
    });

    it('reports a series failure with the series key and keeps state', async () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        savePlaybackPositionsBatch.mockRejectedValue(new Error('boom'));

        const persisted = await service.handle(
            markRequest([101]),
            'playlist-1',
            state,
            () => true,
            'series'
        );

        expect(persisted).toBe(false);
        expect(state.updateMany).not.toHaveBeenCalled();
        expect(snackBarOpen).toHaveBeenCalledWith(
            'XTREAM.SERIES_WATCH_UPDATE_FAILED',
            undefined,
            { duration: 5000 }
        );
        consoleError.mockRestore();
    });

    it('suppresses state writes and feedback after navigation, still reporting persisted', async () => {
        const persisted = await service.handle(
            markRequest([101]),
            'playlist-1',
            state,
            () => false,
            'series'
        );

        expect(persisted).toBe(true);
        expect(state.updateMany).not.toHaveBeenCalled();
        expect(snackBarOpen).not.toHaveBeenCalled();
    });

    it('rejects empty requests and re-entrant calls', async () => {
        expect(
            await service.handle(
                { markWatched: true, requests: [] },
                'playlist-1',
                state,
                () => true,
                'series'
            )
        ).toBe(false);

        let release!: () => void;
        savePlaybackPositionsBatch.mockImplementation(
            () => new Promise<void>((resolve) => (release = resolve))
        );
        const pending = service.handle(
            markRequest([101]),
            'playlist-1',
            state,
            () => true,
            'season'
        );
        expect(service.batchRunning()).toBe(true);
        expect(
            await service.handle(
                markRequest([102]),
                'playlist-1',
                state,
                () => true,
                'series'
            )
        ).toBe(false);
        release();
        await pending;
        expect(service.batchRunning()).toBe(false);
        expect(savePlaybackPositionsBatch).toHaveBeenCalledTimes(1);
    });
});
