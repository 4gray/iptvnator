import { signal } from '@angular/core';
import type {
    PlaybackPositionData,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import { createStalkerVodDetailActions } from './stalker-vod-detail-actions';

const MOVIE = {
    type: 'stalker',
    data: { id: '42' },
    playlistId: 'portal-1',
    cmd: 'ffmpeg http://portal/42',
} as unknown as VodDetailsItem;

const POSITION = {
    playlistId: 'portal-1',
    contentXtreamId: 42,
    contentType: 'vod',
    positionSeconds: 600,
    durationSeconds: 5400,
} as PlaybackPositionData;

describe('createStalkerVodDetailActions resetProgress', () => {
    function setup(selectedVodId: () => number | null) {
        const selectedVodPosition = signal<PlaybackPositionData | null>(
            POSITION
        );
        const clearPlaybackPositionOrThrow = jest
            .fn()
            .mockResolvedValue(undefined);
        const discardPendingPositionLoad = jest.fn();
        const afterProgressReset = jest.fn();
        const open = jest.fn();
        const actions = createStalkerVodDetailActions({
            resolvePlayback: jest.fn(),
            portalPlayer: { openExternalPlayback: jest.fn() },
            playbackPositions: { clearPlaybackPositionOrThrow },
            playlistId: () => 'portal-1',
            selectedVodId,
            selectedVodPosition,
            discardPendingPositionLoad,
            afterProgressReset,
            snackBar: { open },
            translate: { instant: (key: string) => key },
            logError: jest.fn(),
        });
        return {
            actions,
            selectedVodPosition,
            clearPlaybackPositionOrThrow,
            discardPendingPositionLoad,
            afterProgressReset,
            open,
        };
    }

    it('clears the shown position of the movie that is still selected', async () => {
        const t = setup(() => 42);
        await t.actions.resetProgress(MOVIE);

        expect(t.clearPlaybackPositionOrThrow).toHaveBeenCalledWith(
            'portal-1',
            42,
            'vod'
        );
        // No read still in flight may put the row back.
        expect(t.discardPendingPositionLoad).toHaveBeenCalledTimes(1);
        expect(t.selectedVodPosition()).toBeNull();
        expect(t.afterProgressReset).toHaveBeenCalledWith('portal-1');
        expect(t.open).toHaveBeenCalledWith(
            'PORTALS.DETAIL.PROGRESS_RESET',
            undefined,
            expect.anything()
        );
    });

    it('leaves the position of a movie selected meanwhile untouched', async () => {
        // The user moved on to movie 7 while the clear for 42 was pending.
        const t = setup(() => 7);
        await t.actions.resetProgress(MOVIE);

        expect(t.clearPlaybackPositionOrThrow).toHaveBeenCalledWith(
            'portal-1',
            42,
            'vod'
        );
        expect(t.discardPendingPositionLoad).not.toHaveBeenCalled();
        expect(t.selectedVodPosition()).toEqual(POSITION);
        expect(t.afterProgressReset).toHaveBeenCalledWith('portal-1');
    });
});
