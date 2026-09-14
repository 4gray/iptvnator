import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    PlaybackPositionData,
    XtreamVodDetails,
} from '@iptvnator/shared/interfaces';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodDetailsWatchedService } from './vod-details-watched.service';

const PLAYLIST = 'playlist-1';
const VOD_ID = 650020;

const vodItem = (): XtreamVodDetails =>
    ({
        info: {
            name: 'Metadata movie',
            duration_secs: 5400,
        },
        movie_data: {
            stream_id: VOD_ID,
            name: 'Metadata movie',
            container_extension: 'mp4',
        },
    }) as unknown as XtreamVodDetails;

const watchedRow = (): PlaybackPositionData => ({
    playlistId: PLAYLIST,
    contentXtreamId: VOD_ID,
    contentType: 'vod',
    positionSeconds: 5400,
    durationSeconds: 5400,
    updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('VodDetailsWatchedService', () => {
    const routePlaybackPosition = signal<PlaybackPositionData | null>(null);
    const vodPlaybackPosition = signal<PlaybackPositionData | null>(null);
    const inlinePlayback = signal<unknown>(null);
    const matchedExternalPlayback = signal<unknown>(null);
    const isExternalLaunchPending = signal(false);
    const currentPlaylist = signal<{ id: string } | null>({ id: PLAYLIST });
    const routeVodId = signal(VOD_ID);
    const loadAllPositions = jest.fn().mockResolvedValue(undefined);
    const savePlaybackPositionOrThrow = jest.fn().mockResolvedValue(undefined);
    const clearPlaybackPositionOrThrow = jest.fn().mockResolvedValue(undefined);
    const snackBarOpen = jest.fn();
    let service: VodDetailsWatchedService;

    beforeEach(() => {
        routePlaybackPosition.set(null);
        vodPlaybackPosition.set(null);
        inlinePlayback.set(null);
        matchedExternalPlayback.set(null);
        isExternalLaunchPending.set(false);
        currentPlaylist.set({ id: PLAYLIST });
        routeVodId.set(VOD_ID);
        loadAllPositions.mockClear();
        savePlaybackPositionOrThrow.mockClear().mockResolvedValue(undefined);
        clearPlaybackPositionOrThrow.mockClear().mockResolvedValue(undefined);
        snackBarOpen.mockClear();

        TestBed.configureTestingModule({
            providers: [
                VodDetailsWatchedService,
                {
                    provide: VodDetailsPlaybackService,
                    useValue: {
                        routePlaybackPosition,
                        vodPlaybackPosition,
                        inlinePlayback,
                        matchedExternalPlayback,
                        isExternalLaunchPending,
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: { currentPlaylist, loadAllPositions },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        savePlaybackPositionOrThrow,
                        clearPlaybackPositionOrThrow,
                    },
                },
                { provide: MatSnackBar, useValue: { open: snackBarOpen } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(VodDetailsWatchedService);
        service.bind(routeVodId);
    });

    it('marks the route copy watched with the provider runtime and refreshes the catalog', async () => {
        expect(service.isWatched()).toBe(false);

        await expect(service.toggleWatched(vodItem())).resolves.toBe(true);

        expect(savePlaybackPositionOrThrow).toHaveBeenCalledWith(
            PLAYLIST,
            expect.objectContaining({
                contentXtreamId: VOD_ID,
                contentType: 'vod',
                positionSeconds: 5400,
                durationSeconds: 5400,
            })
        );
        expect(service.isWatched()).toBe(true);
        expect(routePlaybackPosition()?.positionSeconds).toBe(5400);
        expect(vodPlaybackPosition()?.positionSeconds).toBe(5400);
        expect(loadAllPositions).toHaveBeenCalledWith(PLAYLIST);
        expect(snackBarOpen).toHaveBeenCalledWith(
            'XTREAM.MOVIE_MARKED_WATCHED',
            undefined,
            expect.anything()
        );
    });

    it('unmarks a watched movie by clearing its row', async () => {
        routePlaybackPosition.set(watchedRow());
        expect(service.isWatched()).toBe(true);

        await expect(service.toggleWatched(vodItem())).resolves.toBe(true);

        expect(clearPlaybackPositionOrThrow).toHaveBeenCalledWith(
            PLAYLIST,
            VOD_ID,
            'vod'
        );
        expect(routePlaybackPosition()).toBeNull();
        expect(service.isWatched()).toBe(false);
        expect(snackBarOpen).toHaveBeenCalledWith(
            'XTREAM.MOVIE_MARKED_UNWATCHED',
            undefined,
            expect.anything()
        );
    });

    it('does not touch the page after the route moved to another movie', async () => {
        let release!: () => void;
        savePlaybackPositionOrThrow.mockReturnValue(
            new Promise<void>((resolve) => {
                release = resolve;
            })
        );

        const pending = service.toggleWatched(vodItem());
        routeVodId.set(999);
        release();
        await expect(pending).resolves.toBe(true);

        expect(routePlaybackPosition()).toBeNull();
        expect(snackBarOpen).not.toHaveBeenCalled();
        // The row landed for that playlist, so its grid still refreshes.
        expect(loadAllPositions).toHaveBeenCalledWith(PLAYLIST);
    });

    it('stays disabled while this movie is playing', () => {
        expect(service.canToggle()).toBe(true);
        inlinePlayback.set({ streamUrl: 'x' });
        expect(service.canToggle()).toBe(false);
        inlinePlayback.set(null);
        matchedExternalPlayback.set({ id: 'mpv' });
        expect(service.canToggle()).toBe(false);
        matchedExternalPlayback.set(null);
        isExternalLaunchPending.set(true);
        expect(service.canToggle()).toBe(false);
    });

    it('refuses without a playlist or a positive vod id', async () => {
        currentPlaylist.set(null);
        await expect(service.toggleWatched(vodItem())).resolves.toBe(false);
        currentPlaylist.set({ id: PLAYLIST });
        routeVodId.set(NaN);
        await expect(service.toggleWatched(vodItem())).resolves.toBe(false);
        expect(savePlaybackPositionOrThrow).not.toHaveBeenCalled();
    });

    it('reports a refused write and keeps the rendered state', async () => {
        savePlaybackPositionOrThrow.mockRejectedValue(new Error('nope'));
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        await expect(service.toggleWatched(vodItem())).resolves.toBe(false);

        expect(service.isWatched()).toBe(false);
        expect(loadAllPositions).not.toHaveBeenCalled();
        expect(snackBarOpen).toHaveBeenCalledWith(
            'XTREAM.MOVIE_WATCH_UPDATE_FAILED',
            undefined,
            expect.anything()
        );
        errorSpy.mockRestore();
    });
});
