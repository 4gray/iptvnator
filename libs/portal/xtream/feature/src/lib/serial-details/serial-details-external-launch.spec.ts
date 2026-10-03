import { signal } from '@angular/core';
import type {
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { openEpisodeExternally } from './serial-details-external-launch';

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

describe('openEpisodeExternally', () => {
    function host(active: ExternalPlayerSession | null) {
        const openExternalPlayback = jest.fn().mockResolvedValue(undefined);
        const closeSession = jest.fn().mockResolvedValue(undefined);
        const launchOwner = jest.fn().mockReturnValue('xtream-1:103');
        return {
            openExternalPlayback,
            closeSession,
            launchOwner,
            host: {
                portalPlayer: { openExternalPlayback },
                externalPlayback: {
                    activeSession: signal(active),
                    closeSession,
                },
                launchOwner,
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

    it('ignores a repeat before the first launch settled', async () => {
        const t = host(null);
        let settleLaunch: () => void = () => undefined;
        t.openExternalPlayback.mockImplementation(
            () => new Promise<void>((resolve) => (settleLaunch = resolve))
        );
        const first = openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        await openEpisodeExternally(t.host, PLAYBACK, 'mpv');
        settleLaunch();
        await first;

        expect(t.openExternalPlayback).toHaveBeenCalledTimes(1);
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
