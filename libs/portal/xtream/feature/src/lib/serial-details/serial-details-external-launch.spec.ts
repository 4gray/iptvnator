import { signal } from '@angular/core';
import type {
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    externalEpisodeSessionIds,
    isEpisodeLaunchPending,
    openEpisodeExternally,
    queueEpisodeChoice,
} from './serial-details-external-launch';

describe('externalEpisodeSessionIds', () => {
    it('reports the launching or playing episode of the shown series only', () => {
        expect(externalEpisodeSessionIds(null, '103', 'xtream-1')).toEqual({
            opening: null,
            active: null,
        });
        expect(
            externalEpisodeSessionIds(
                session({ status: 'launching' }),
                '103',
                'xtream-1'
            )
        ).toEqual({ opening: 1001, active: null });
        expect(externalEpisodeSessionIds(session(), '103', 'xtream-1')).toEqual(
            {
                opening: null,
                active: 1001,
            }
        );
        expect(externalEpisodeSessionIds(session(), '104', 'xtream-1')).toEqual(
            {
                opening: null,
                active: null,
            }
        );
        expect(externalEpisodeSessionIds(session(), '103', 'xtream-2')).toEqual(
            {
                opening: null,
                active: null,
            }
        );
    });
});

const PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'http://xtream.example/series/1002.mp4',
    title: 'Episode 2',
    contentInfo: {
        playlistId: 'xtream-1',
        contentXtreamId: 1002,
        contentType: 'episode',
        seriesXtreamId: 103,
    },
};

function session(
    overrides: Partial<ExternalPlayerSession> = {}
): ExternalPlayerSession {
    return {
        id: 'mpv-1',
        player: 'mpv',
        status: 'opened',
        canClose: true,
        contentInfo: {
            playlistId: 'xtream-1',
            contentXtreamId: 1001,
            contentType: 'episode',
            seriesXtreamId: 103,
        },
        ...overrides,
    } as ExternalPlayerSession;
}

/** Lets the launch chain's microtasks run up to the player call. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('openEpisodeExternally', () => {
    function host(active: ExternalPlayerSession | null) {
        const openExternalPlayback = jest.fn().mockResolvedValue(undefined);
        const closeSession = jest.fn().mockResolvedValue(undefined);
        const launchOwner = jest.fn().mockReturnValue('xtream-1:103');
        const pageToken = jest.fn().mockReturnValue('xtream-1:103#1');
        return {
            openExternalPlayback,
            closeSession,
            launchOwner,
            pageToken,
            host: {
                portalPlayer: { openExternalPlayback },
                externalPlayback: {
                    activeSession: signal(active),
                    closeSession,
                },
                launchOwner,
                pageToken,
            },
        };
    }

    it('closes the running episode of this series before launching', async () => {
        const running = session();
        const t = host(running);
        await openEpisodeExternally(t.host, PLAYBACK, 'vlc');

        expect(t.closeSession).toHaveBeenCalledWith(running);
        expect(t.closeSession.mock.invocationCallOrder[0]).toBeLessThan(
            t.openExternalPlayback.mock.invocationCallOrder[0]
        );
        expect(t.openExternalPlayback).toHaveBeenCalledWith(PLAYBACK, 'vlc');
    });

    it('leaves another title alone and launches beside it', async () => {
        const other = session({
            contentInfo: {
                playlistId: 'xtream-1',
                contentXtreamId: 777,
                contentType: 'vod',
            },
        });
        const t = host(other);
        await openEpisodeExternally(t.host, PLAYBACK, 'mpv');

        expect(t.closeSession).not.toHaveBeenCalled();
        expect(t.openExternalPlayback).toHaveBeenCalledWith(PLAYBACK, 'mpv');
    });

    it('drops the launch when the page moved on while the close ran', async () => {
        const t = host(session());
        t.closeSession.mockImplementation(async () => {
            t.launchOwner.mockReturnValue('xtream-1:999');
        });
        await openEpisodeExternally(t.host, PLAYBACK, 'mpv');

        expect(t.closeSession).toHaveBeenCalledTimes(1);
        expect(t.openExternalPlayback).not.toHaveBeenCalled();
    });

    it('closes the player a launch opened after the page moved on', async () => {
        const t = host(null);
        const opened = session({ id: 'mpv-2', status: 'launching' });
        t.openExternalPlayback.mockImplementation(async () => {
            // The viewer opens another title while the launch sits inside
            // the player IPC.
            t.launchOwner.mockReturnValue('xtream-1:999');
            return opened;
        });

        await expect(
            openEpisodeExternally(t.host, PLAYBACK, 'mpv')
        ).resolves.toBeUndefined();

        expect(t.closeSession).toHaveBeenCalledWith(opened);
    });

    it('ignores a repeat before the first launch settled', async () => {
        const t = host(null);
        let settleLaunch: () => void = () => undefined;
        t.openExternalPlayback.mockImplementation(
            () => new Promise<void>((resolve) => (settleLaunch = resolve))
        );
        const first = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        await openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        await flush();
        expect(t.openExternalPlayback).toHaveBeenCalledTimes(1);
        settleLaunch();
        await first;

        expect(t.openExternalPlayback).toHaveBeenCalledTimes(1);
    });

    it('queues another episode behind the first launch instead of dropping it', async () => {
        const t = host(null);
        let settleLaunch: () => void = () => undefined;
        t.openExternalPlayback.mockImplementationOnce(
            () => new Promise<void>((resolve) => (settleLaunch = resolve))
        );
        const first = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        const second = openEpisodeExternally(
            t.host,
            {
                ...PLAYBACK,
                streamUrl: 'http://xtream.example/series/1003.mp4',
                contentInfo: {
                    ...PLAYBACK.contentInfo!,
                    contentXtreamId: 1003,
                },
            },
            'mpv'
        );
        await flush();
        expect(t.openExternalPlayback).toHaveBeenCalledTimes(1);

        settleLaunch();
        await first;
        await second;
        expect(t.openExternalPlayback).toHaveBeenCalledTimes(2);
        expect(t.openExternalPlayback.mock.calls[1][0]).toEqual(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/1003.mp4',
            })
        );
    });

    it('reports the owner as pending until the launch settles', async () => {
        const t = host(null);
        let settleLaunch: () => void = () => undefined;
        t.openExternalPlayback.mockImplementation(
            () => new Promise<void>((resolve) => (settleLaunch = resolve))
        );
        expect(isEpisodeLaunchPending('xtream-1:103')).toBe(false);
        const launch = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        expect(isEpisodeLaunchPending('xtream-1:103')).toBe(true);
        expect(isEpisodeLaunchPending('xtream-1:104')).toBe(false);

        await flush();
        settleLaunch();
        await launch;
        expect(isEpisodeLaunchPending('xtream-1:103')).toBe(false);
    });

    it('leaves the player alone when the page moved on before a queued launch ran', async () => {
        const running = session();
        const t = host(running);
        let settleLaunch: () => void = () => undefined;
        t.openExternalPlayback.mockImplementationOnce(
            () => new Promise<void>((resolve) => (settleLaunch = resolve))
        );
        const first = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        const second = openEpisodeExternally(
            t.host,
            {
                ...PLAYBACK,
                contentInfo: {
                    ...PLAYBACK.contentInfo!,
                    contentXtreamId: 1003,
                },
            },
            'mpv'
        );
        await flush();
        t.closeSession.mockClear();
        // The viewer left the series before the queued launch's turn.
        t.launchOwner.mockReturnValue('xtream-1:999');
        settleLaunch();
        await first;
        await second;

        expect(t.closeSession).not.toHaveBeenCalled();
        expect(t.openExternalPlayback).toHaveBeenCalledTimes(1);
    });

    it('starts only the latest queued choice once the launch settled', async () => {
        const t = host(null);
        let settleLaunch: () => void = () => undefined;
        t.openExternalPlayback.mockImplementation(
            () => new Promise<void>((resolve) => (settleLaunch = resolve))
        );
        const launch = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        // The first page queues, the viewer reopens the series and queues
        // again: the reopened page's start runs, with its episode.
        const startOld = jest.fn();
        const startNew = jest.fn();
        queueEpisodeChoice(t.host, 'xtream-1:103', 'episode-1', startOld);
        queueEpisodeChoice(t.host, 'xtream-1:103', 'episode-2', startNew);
        await flush();
        expect(startOld).not.toHaveBeenCalled();

        settleLaunch();
        await launch;
        await flush();
        expect(startOld).not.toHaveBeenCalled();
        expect(startNew).toHaveBeenCalledTimes(1);
        expect(startNew).toHaveBeenCalledWith('episode-2');
    });

    it('closes the player the launch opened before the queued choice starts', async () => {
        const t = host(null);
        const opened = session({ id: 'mpv-2', status: 'launching' });
        t.openExternalPlayback.mockImplementation(async () => {
            t.host.externalPlayback.activeSession.set(opened);
            return opened;
        });
        let settleClose: () => void = () => undefined;
        t.closeSession.mockImplementation(
            () => new Promise<void>((resolve) => (settleClose = resolve))
        );
        const launch = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        const start = jest.fn();
        queueEpisodeChoice(t.host, 'xtream-1:103', 'episode-3', start);

        await launch;
        await flush();
        // The choice must not play beside the player that just opened, and
        // nothing else may start while that player closes.
        expect(t.closeSession).toHaveBeenCalledWith(opened);
        expect(start).not.toHaveBeenCalled();
        expect(isEpisodeLaunchPending('xtream-1:103')).toBe(true);

        settleClose();
        await flush();
        expect(start).toHaveBeenCalledWith('episode-3');
        expect(isEpisodeLaunchPending('xtream-1:103')).toBe(false);
    });

    it('starts only the choice made while the opened player closed', async () => {
        const t = host(null);
        const opened = session({ id: 'mpv-2' });
        t.openExternalPlayback.mockImplementation(async () => {
            t.host.externalPlayback.activeSession.set(opened);
            return opened;
        });
        let settleClose: () => void = () => undefined;
        t.closeSession.mockImplementation(
            () => new Promise<void>((resolve) => (settleClose = resolve))
        );
        const launch = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        const earlier = jest.fn();
        const latest = jest.fn();
        queueEpisodeChoice(t.host, 'xtream-1:103', 'episode-3', earlier);
        await launch;
        await flush();
        expect(t.closeSession).toHaveBeenCalledTimes(1);

        // Still pending while the player closes: the newer choice replaces
        // the queued one instead of starting beside it afterwards.
        expect(isEpisodeLaunchPending('xtream-1:103')).toBe(true);
        queueEpisodeChoice(t.host, 'xtream-1:103', 'episode-4', latest);

        settleClose();
        await flush();
        expect(earlier).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);
        expect(latest).toHaveBeenCalledWith('episode-4');
        expect(t.closeSession).toHaveBeenCalledTimes(1);
    });

    it('drops the queued choice when the opened player cannot be closed', async () => {
        const t = host(null);
        const opened = session({ id: 'mpv-2' });
        t.openExternalPlayback.mockImplementation(async () => {
            t.host.externalPlayback.activeSession.set(opened);
            return opened;
        });
        t.closeSession.mockRejectedValue(new Error('busy'));
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const launch = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        const start = jest.fn();
        queueEpisodeChoice(t.host, 'xtream-1:103', 'episode-3', start);

        await launch;
        await flush();
        expect(t.closeSession).toHaveBeenCalledWith(opened);
        expect(start).not.toHaveBeenCalled();
        expect(isEpisodeLaunchPending('xtream-1:103')).toBe(false);
    });

    it('lets a reopened series launch the episode an earlier visit still settles', async () => {
        const first = host(session());
        let settleClose: () => void = () => undefined;
        first.closeSession.mockImplementation(
            () => new Promise<void>((resolve) => (settleClose = resolve))
        );
        const stale = openEpisodeExternally(first.host, PLAYBACK, 'mpv');
        // The viewer left; this visit's page is gone.
        first.launchOwner.mockReturnValue(null);

        const reopened = host(null);
        reopened.pageToken.mockReturnValue('xtream-1:103#2');
        const fresh = openEpisodeExternally(reopened.host, PLAYBACK, 'mpv');
        settleClose();
        await stale;
        await fresh;

        expect(first.openExternalPlayback).not.toHaveBeenCalled();
        expect(reopened.openExternalPlayback).toHaveBeenCalledTimes(1);
    });

    it('keeps the running player when closing it fails', async () => {
        const t = host(session());
        t.closeSession.mockRejectedValue(new Error('still busy'));
        const warn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        await expect(
            openEpisodeExternally(t.host, PLAYBACK, 'mpv')
        ).resolves.toBeUndefined();

        expect(t.openExternalPlayback).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
