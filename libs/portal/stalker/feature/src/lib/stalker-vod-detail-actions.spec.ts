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
        let rejectLink: (error: unknown) => void = () => undefined;
        const resolvePlayback = jest.fn(
            () =>
                new Promise((resolve, reject) => {
                    resolveLink = resolve;
                    rejectLink = reject;
                })
        );
        const open = jest.fn();
        const logError = jest.fn();
        const openExternalPlayback = jest.fn().mockResolvedValue(undefined);
        const beforeExternalLaunch = jest.fn();
        const closeSession = jest.fn().mockResolvedValue(undefined);
        const running = signal<ExternalPlayerSession | null>(null);
        const settlePendingStart = jest.fn();
        let launchCurrent = true;
        const beginPendingStart = jest.fn().mockReturnValue({
            settle: settlePendingStart,
            isCurrent: () => launchCurrent,
            rebase: () => (launchCurrent = true),
        });
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
            snackBar: { open },
            translate: { instant: (key: string) => key },
            logError,
        });
        return {
            actions,
            openExternalPlayback,
            beforeExternalLaunch,
            closeSession,
            open,
            logError,
            rejectLink: (error: unknown) => rejectLink(error),
            beginPendingStart,
            settlePendingStart,
            supersede: () => (launchCurrent = false),
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

    it('closes the player a launch opened after the page moved on', async () => {
        let selected = 42;
        const t = setup(() => selected);
        const opened = {
            id: 'mpv-7',
            status: 'launching',
        } as ExternalPlayerSession;
        t.openExternalPlayback.mockResolvedValue(opened);
        const launch = t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        t.resolveLink();
        await Promise.resolve();
        await Promise.resolve();
        // The launch is inside the player IPC when the viewer opens another
        // movie: its player must not open beside that one.
        selected = 43;
        await launch;

        expect(t.openExternalPlayback).toHaveBeenCalledTimes(1);
        expect(t.closeSession).toHaveBeenCalledWith(opened);
        expect(t.open).not.toHaveBeenCalled();
    });

    it('drops the launch once a newer start superseded it', async () => {
        const t = setup(() => 42);
        const launch = t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        // Play/Resume (or another launch) began while the link resolved.
        t.supersede();
        t.resolveLink();
        await launch;

        expect(t.beforeExternalLaunch).not.toHaveBeenCalled();
        expect(t.openExternalPlayback).not.toHaveBeenCalled();
        expect(t.settlePendingStart).toHaveBeenCalledTimes(1);
    });

    it('stays silent when a superseded launch fails', async () => {
        const t = setup(() => 42);
        const launch = t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        t.supersede();
        t.rejectLink(new Error('create_link timed out'));
        await launch;

        expect(t.open).not.toHaveBeenCalled();
        expect(t.logError).not.toHaveBeenCalled();
    });

    it('stays silent when a newer start superseded a launch already running', async () => {
        const t = setup(() => 42);
        let rejectLaunch: (error: unknown) => void = () => undefined;
        t.openExternalPlayback.mockImplementation(
            () => new Promise((_, reject) => (rejectLaunch = reject))
        );
        const launch = t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        t.resolveLink();
        await new Promise((resolve) => setTimeout(resolve));
        // Play pressed while the IPC was pending, then the old launch fails.
        t.supersede();
        rejectLaunch(new Error('no player'));
        await launch;

        expect(t.open).not.toHaveBeenCalled();
    });

    it('reports a failed launch although its own teardown retired the request', async () => {
        const t = setup(() => 42);
        // The host closes the inline player before the launch, bumping its
        // request id like a start would.
        t.beforeExternalLaunch.mockImplementation(() => t.supersede());
        t.openExternalPlayback.mockRejectedValue(new Error('no player'));
        const launch = t.actions.openExternal({
            item: MOVIE,
            player: 'mpv',
            positionSeconds: null,
        });
        t.resolveLink();
        await launch;

        expect(t.logError).toHaveBeenCalledTimes(1);
        expect(t.open).toHaveBeenCalledWith(
            'PORTALS.PLAYBACK_ERROR',
            undefined,
            expect.anything()
        );
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
        const settlePendingStart = jest.fn();
        const beginPendingStart = jest.fn().mockReturnValue({
            settle: settlePendingStart,
            isCurrent: () => true,
            rebase: jest.fn(),
        });
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
            beginPendingStart,
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
            beginPendingStart,
            settlePendingStart,
        };
    }

    it("holds the movie's starts until the clear landed", async () => {
        const t = setup(() => 42);
        let finishClear: () => void = () => undefined;
        t.clearPlaybackPositionOrThrow.mockImplementationOnce(
            () => new Promise<void>((resolve) => (finishClear = resolve))
        );

        const reset = t.actions.resetProgress(MOVIE);
        // A start made now would resume from the row being cleared.
        expect(t.beginPendingStart).toHaveBeenCalledTimes(1);
        expect(t.settlePendingStart).not.toHaveBeenCalled();

        finishClear();
        await reset;
        expect(t.settlePendingStart).toHaveBeenCalledTimes(1);
        expect(t.selectedVodPosition()).toBeNull();
    });

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
