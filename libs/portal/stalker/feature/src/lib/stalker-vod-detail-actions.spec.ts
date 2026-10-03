import { signal } from '@angular/core';
import type {
    ExternalPlayerSession,
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

describe('createStalkerVodDetailActions openExternal', () => {
    function setup(selectedVodId: () => number | null) {
        let resolveLink: (playback: unknown) => void = () => undefined;
        const resolvePlayback = jest.fn(
            () => new Promise((resolve) => (resolveLink = resolve))
        );
        const openExternalPlayback = jest.fn().mockResolvedValue(undefined);
        const beforeExternalLaunch = jest.fn();
        const closeSession = jest.fn().mockResolvedValue(undefined);
        const running = signal<ExternalPlayerSession | null>(null);
        const settlePendingStart = jest.fn();
        const beginPendingStart = jest.fn().mockReturnValue(settlePendingStart);
        const actions = createStalkerVodDetailActions({
            resolvePlayback: resolvePlayback as never,
            portalPlayer: { openExternalPlayback },
            externalPlayback: { activeSession: running, closeSession },
            beginPendingStart,
            playbackPositions: { clearPlaybackPositionOrThrow: jest.fn() },
            playlistId: () => 'portal-1',
            selectedVodId,
            selectedVodPosition: signal(null),
            beforeExternalLaunch,
            snackBar: { open: jest.fn() },
            translate: { instant: (key: string) => key },
            logError: jest.fn(),
        });
        return {
            actions,
            openExternalPlayback,
            beforeExternalLaunch,
            closeSession,
            beginPendingStart,
            settlePendingStart,
            setRunning: (session: ExternalPlayerSession | null) =>
                running.set(session),
            resolveLink: () => resolveLink({ streamUrl: 'http://cdn/42.mp4' }),
        };
    }

    it('closes the movie that is already playing externally before relaunching', async () => {
        const t = setup(() => 42);
        const running = {
            id: 'mpv-1',
            player: 'mpv',
            status: 'opened',
            canClose: true,
            contentInfo: {
                playlistId: 'portal-1',
                contentXtreamId: 42,
                contentType: 'vod',
            },
        } as ExternalPlayerSession;
        t.setRunning(running);
        const launch = t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        t.resolveLink();
        await launch;

        expect(t.closeSession).toHaveBeenCalledWith(running);
        expect(t.closeSession.mock.invocationCallOrder[0]).toBeLessThan(
            t.openExternalPlayback.mock.invocationCallOrder[0]
        );
    });

    it('launches the resolved stream while the movie is still selected', async () => {
        const t = setup(() => 42);
        const launch = t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        t.resolveLink();
        await launch;

        expect(t.beforeExternalLaunch).toHaveBeenCalledTimes(1);
        expect(t.openExternalPlayback).toHaveBeenCalledWith(
            { streamUrl: 'http://cdn/42.mp4' },
            'mpv'
        );
        // Pending from the click until the launch settled: a reset meanwhile
        // would be undone by the start.
        expect(t.beginPendingStart).toHaveBeenCalledTimes(1);
        expect(t.settlePendingStart).toHaveBeenCalledTimes(1);
        expect(t.beginPendingStart.mock.invocationCallOrder[0]).toBeLessThan(
            t.openExternalPlayback.mock.invocationCallOrder[0]
        );
    });

    it('ignores a second launch while the first is still resolving', async () => {
        const t = setup(() => 42);
        const first = t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        await t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        t.resolveLink();
        await first;

        expect(t.beginPendingStart).toHaveBeenCalledTimes(1);
        expect(t.openExternalPlayback).toHaveBeenCalledTimes(1);
    });

    it('still launches another movie while the first link resolves', async () => {
        let selected = 42;
        const t = setup(() => selected);
        void t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        selected = 7;
        const other = {
            ...MOVIE,
            data: { id: '7' },
        } as unknown as VodDetailsItem;
        const second = t.actions.openExternal({
            item: other,
            player: 'mpv',
            positionSeconds: null,
        });
        t.resolveLink();
        await second;

        expect(t.beginPendingStart).toHaveBeenCalledTimes(2);
        expect(t.openExternalPlayback).toHaveBeenCalledTimes(1);
    });

    it('still rejects a repeat of the first movie after another one was started', async () => {
        let selected = 42;
        const t = setup(() => selected);
        const other = {
            ...MOVIE,
            data: { id: '7' },
        } as unknown as VodDetailsItem;
        const launch = (item: VodDetailsItem) =>
            t.actions.openExternal({
                item,
                player: 'mpv',
                positionSeconds: null,
            });
        void launch(MOVIE);
        selected = 7;
        void launch(other);
        selected = 42;
        await launch(MOVIE);

        // A, B, A again: the second A is a repeat of a pending launch.
        expect(t.beginPendingStart).toHaveBeenCalledTimes(2);
        expect(t.openExternalPlayback).not.toHaveBeenCalled();
    });

    it('drops the stream once another movie was selected meanwhile', async () => {
        let selected = 42;
        const t = setup(() => selected);
        const launch = t.actions.openExternal({
            item: MOVIE,
            player: 'vlc',
            positionSeconds: null,
        });
        selected = 7;
        t.resolveLink();
        await launch;

        // Neither the old movie's player nor the new movie's inline playback
        // is touched.
        expect(t.beforeExternalLaunch).not.toHaveBeenCalled();
        expect(t.openExternalPlayback).not.toHaveBeenCalled();
    });
});

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
            externalPlayback: {
                activeSession: signal(null),
                closeSession: jest.fn(),
            },
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
