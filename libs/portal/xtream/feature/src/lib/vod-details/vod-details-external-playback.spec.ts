import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import type { PlayerContentInfo } from '@iptvnator/shared/interfaces';
import { VodDetailsPlaybackService } from './vod-details-playback.service';

/**
 * Which external session this page owns.
 *
 * Multi-source can launch MPV/VLC for a movie in ANOTHER playlist, and the
 * session then carries that playlist's ids — so the matcher decides whether
 * the primary button can stop it or silently launches a second player.
 */
/**
 * Which external process this page owns, and what replacing it entails.
 * Split from the position/ownership spec to keep both inside the file-size
 * rule.
 */
describe('VodDetailsPlaybackService — external playback handoff', () => {
    const ROUTE_PLAYLIST = 'playlist-1';
    const ROUTE_VOD_ID = 650020;

    let service: VodDetailsPlaybackService;
    const addRecentItem = jest.fn();
    const activeSession = signal<unknown>(null);
    const closeSession = jest.fn().mockResolvedValue(undefined);
    const openResolvedPlayback = jest.fn();
    const activeSource = signal<PlayerContentInfo | null>(null);
    const currentPlaylist = signal({ id: ROUTE_PLAYLIST });
    const routeVodId = signal(ROUTE_VOD_ID);

    function sessionFor(playlistId: string, contentXtreamId: number) {
        return {
            id: `${playlistId}:${contentXtreamId}`,
            player: 'mpv',
            status: 'playing',
            title: 'Example Movie',
            streamUrl: 'https://example.com/movie.mkv',
            startedAt: '2026-08-08T00:00:00.000Z',
            updatedAt: '2026-08-08T00:00:00.000Z',
            canClose: true,
            contentInfo: {
                playlistId,
                contentXtreamId,
                contentType: 'vod' as const,
            },
        };
    }

    beforeEach(() => {
        activeSession.set(null);
        activeSource.set(null);
        currentPlaylist.set({ id: ROUTE_PLAYLIST });
        routeVodId.set(ROUTE_VOD_ID);
        addRecentItem.mockClear();
        closeSession.mockReset().mockResolvedValue(undefined);
        openResolvedPlayback
            .mockReset()
            .mockResolvedValue(sessionFor('playlist-2', 991));

        TestBed.configureTestingModule({
            providers: [
                VodDetailsPlaybackService,
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist,
                        addRecentItem,
                        constructVodStreamUrl: jest
                            .fn()
                            .mockReturnValue('https://example.com/route.mkv'),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession, closeSession },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition: jest.fn(),
                        savePlaybackPosition: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: jest.fn().mockReturnValue(false),
                        openResolvedPlayback,
                    },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: {
                        onPlaybackPositionUpdate: () => () => undefined,
                    },
                },
            ],
        });

        service = TestBed.inject(VodDetailsPlaybackService);
        service.bind({
            vodId: routeVodId,
            vodInfo: signal(null),
            activeSource,
        });
    });

    it('closes the alternative it launched, once the badge has moved on', async () => {
        // Ownership survives controller refreshes or overlapping UI state:
        // the exact process this page launched still has to close first.
        activeSession.set(sessionFor('playlist-2', 991));
        activeSource.set({
            playlistId: 'playlist-3',
            contentXtreamId: 77,
            contentType: 'vod',
        });
        closeSession.mockClear();

        // Pretend the alternative we are replacing is the one we started.
        await service.startResolvedPlayback({
            streamUrl: 'https://example.com/first.mkv',
            title: 'Example Movie',
            contentInfo: {
                playlistId: 'playlist-2',
                contentXtreamId: 991,
                contentType: 'vod',
            },
        });
        closeSession.mockClear();

        await service.startResolvedPlayback({
            streamUrl: 'https://example.com/second.mkv',
            title: 'Example Movie',
            contentInfo: {
                playlistId: 'playlist-3',
                contentXtreamId: 77,
                contentType: 'vod',
            },
        });

        expect(closeSession).toHaveBeenCalledWith(
            expect.objectContaining({
                contentInfo: expect.objectContaining({
                    contentXtreamId: 991,
                }),
            })
        );
    });

    it('cancels the replacement when closing the old player fails', async () => {
        activeSession.set(sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID));
        closeSession.mockRejectedValue(new Error('close ipc failed'));
        openResolvedPlayback.mockClear();

        await expect(
            service.startResolvedPlayback({
                streamUrl: 'https://example.com/alt.mkv',
                title: 'Example Movie',
            })
        ).resolves.toBe(false);

        expect(openResolvedPlayback).not.toHaveBeenCalled();

        closeSession.mockResolvedValue(undefined);
    });

    it('cancels the replacement while a live session cannot be closed', async () => {
        activeSession.set({
            ...sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID),
            status: 'launching',
            canClose: false,
        });
        openResolvedPlayback.mockClear();

        await expect(
            service.startResolvedPlayback({
                streamUrl: 'https://example.com/alt.mkv',
                title: 'Example Movie',
            })
        ).resolves.toBe(false);

        expect(closeSession).not.toHaveBeenCalled();
        expect(openResolvedPlayback).not.toHaveBeenCalled();
    });

    it('rejects a handoff when the external player launch fails', async () => {
        openResolvedPlayback.mockRejectedValueOnce(
            new Error('previous player is still shutting down')
        );

        await expect(
            service.startResolvedPlayback({
                streamUrl: 'https://example.com/alt.mkv',
                title: 'Example Movie',
                contentInfo: {
                    playlistId: 'playlist-2',
                    contentXtreamId: 991,
                    contentType: 'vod',
                },
            })
        ).resolves.toBe(false);

        expect(openResolvedPlayback).toHaveBeenCalledTimes(1);
    });

    it('closes a closable error before starting a replacement source', async () => {
        activeSession.set({
            ...sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID),
            status: 'error',
            error: 'Process exit was not confirmed',
            canClose: true,
        });
        closeSession.mockClear();

        await service.startResolvedPlayback({
            streamUrl: 'https://example.com/alt.mkv',
            title: 'Example Movie',
        });

        expect(closeSession).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'error', canClose: true })
        );
    });

    it('launches only the newest source when two switches overlap', async () => {
        activeSession.set(sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID));
        // One shared promise: both calls see the same running session, so
        // both await the same close rather than each making its own.
        let releaseClose: (() => void) | undefined;
        const closing = new Promise<void>((resolve) => {
            releaseClose = () => resolve();
        });
        closeSession.mockReturnValue(closing);
        // These spies are module-level and never cleared between cases.
        openResolvedPlayback.mockClear();

        const first = service.startResolvedPlayback({
            streamUrl: 'https://example.com/one.mkv',
            title: 'Example Movie',
        });
        const second = service.startResolvedPlayback({
            streamUrl: 'https://example.com/two.mkv',
            title: 'Example Movie',
        });

        releaseClose?.();
        await Promise.all([first, second]);

        // Both saw the same running session and awaited its close. Launching
        // both afterwards is how two detached players appear again, with the
        // older one holding a source the user has already moved on from.
        expect(openResolvedPlayback).toHaveBeenCalledTimes(1);
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'https://example.com/two.mkv',
            }),
            true
        );

        closeSession.mockResolvedValue(undefined);
    });

    it('checks host ownership after teardown before applying playback', async () => {
        activeSession.set(sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID));
        let releaseClose: (() => void) | undefined;
        const closing = new Promise<void>((resolve) => {
            releaseClose = resolve;
        });
        closeSession.mockReturnValue(closing);
        openResolvedPlayback.mockClear();
        let ownsSwitch = true;

        const switching = service.startResolvedPlayback(
            {
                streamUrl: 'https://example.com/alt.mkv',
                title: 'Example Movie',
            },
            () => ownsSwitch
        );
        ownsSwitch = false;
        releaseClose?.();

        await expect(switching).resolves.toBe(false);
        expect(openResolvedPlayback).not.toHaveBeenCalled();

        closeSession.mockResolvedValue(undefined);
    });

    it('closes a launch that loses host ownership while IPC is pending', async () => {
        let releaseLaunch: ((value: unknown) => void) | undefined;
        const launched = sessionFor('playlist-2', 991);
        openResolvedPlayback.mockReturnValueOnce(
            new Promise((resolve) => {
                releaseLaunch = resolve;
            })
        );
        let ownsSwitch = true;

        const switching = service.startResolvedPlayback(
            {
                streamUrl: 'https://example.com/alt.mkv',
                title: 'Example Movie',
                contentInfo: launched.contentInfo,
            },
            () => ownsSwitch
        );
        while (openResolvedPlayback.mock.calls.length === 0) {
            await Promise.resolve();
        }
        ownsSwitch = false;
        releaseLaunch?.(launched);

        await expect(switching).resolves.toBe(false);
        expect(closeSession).toHaveBeenCalledWith(launched);
    });

    it('retains a stale launch when its exact close fails', async () => {
        let releaseLaunch: ((value: unknown) => void) | undefined;
        const launched = sessionFor('playlist-2', 991);
        const failed = {
            ...launched,
            status: 'error',
            error: 'Process exit was not confirmed',
            canClose: true,
        };
        openResolvedPlayback.mockReturnValueOnce(
            new Promise((resolve) => {
                releaseLaunch = resolve;
            })
        );
        closeSession.mockRejectedValueOnce(new Error('close ipc failed'));
        let ownsSwitch = true;

        const switching = service.startResolvedPlayback(
            {
                streamUrl: 'https://example.com/alt.mkv',
                title: 'Example Movie',
                contentInfo: launched.contentInfo,
            },
            () => ownsSwitch
        );
        while (openResolvedPlayback.mock.calls.length === 0) {
            await Promise.resolve();
        }
        ownsSwitch = false;
        activeSession.set(failed);
        releaseLaunch?.(launched);

        await expect(switching).resolves.toBe(false);
        expect(service.matchedExternalPlayback()?.id).toBe(failed.id);

        await service.startResolvedPlayback({
            streamUrl: 'https://example.com/third.mkv',
            title: 'Example Movie',
            contentInfo: {
                playlistId: 'playlist-3',
                contentXtreamId: 992,
                contentType: 'vod',
            },
        });
        expect(closeSession).toHaveBeenLastCalledWith(failed);
    });

    it('does not commit a session stopped while launch IPC is pending', async () => {
        openResolvedPlayback.mockResolvedValueOnce({
            ...sessionFor('playlist-2', 991),
            status: 'closed',
            canClose: false,
        });

        await expect(
            service.startResolvedPlayback({
                streamUrl: 'https://example.com/alt.mkv',
                title: 'Example Movie',
            })
        ).resolves.toBe(false);
    });

    it('owns an alternative immediately while its external launch is pending', async () => {
        let releaseLaunch: ((value: unknown) => void) | undefined;
        const launching = {
            ...sessionFor('playlist-2', 991),
            status: 'launching',
        };
        openResolvedPlayback.mockReturnValueOnce(
            new Promise((resolve) => {
                releaseLaunch = resolve;
            })
        );

        const switching = service.startResolvedPlayback({
            streamUrl: 'https://example.com/alt.mkv',
            title: 'Example Movie',
            contentInfo: launching.contentInfo,
        });
        while (openResolvedPlayback.mock.calls.length === 0) {
            await Promise.resolve();
        }

        expect(service.isExternalLaunchPending()).toBe(true);
        activeSession.set(launching);
        expect(service.matchedExternalPlayback()?.id).toBe(launching.id);

        const opened = { ...launching, status: 'opened' };
        activeSession.set(opened);
        releaseLaunch?.(opened);
        await expect(switching).resolves.toBe(true);
        expect(service.isExternalLaunchPending()).toBe(false);
    });

    it('keeps the pending launch when an unclosable source replacement is denied', async () => {
        let releaseLaunch: ((value: unknown) => void) | undefined;
        const launching = {
            ...sessionFor('playlist-2', 991),
            status: 'launching',
            canClose: false,
        };
        openResolvedPlayback.mockReturnValueOnce(
            new Promise((resolve) => {
                releaseLaunch = resolve;
            })
        );

        const first = service.startResolvedPlayback({
            streamUrl: 'https://example.com/first.mkv',
            title: 'Example Movie',
            contentInfo: launching.contentInfo,
        });
        while (openResolvedPlayback.mock.calls.length === 0) {
            await Promise.resolve();
        }
        activeSession.set(launching);

        await expect(
            service.startResolvedPlayback({
                streamUrl: 'https://example.com/second.mkv',
                title: 'Example Movie',
                contentInfo: {
                    playlistId: 'playlist-3',
                    contentXtreamId: 77,
                    contentType: 'vod',
                },
            })
        ).resolves.toBe(false);

        const opened = { ...launching, status: 'opened' };
        activeSession.set(opened);
        releaseLaunch?.(opened);

        await expect(first).resolves.toBe(true);
        expect(openResolvedPlayback).toHaveBeenCalledTimes(1);
        expect(closeSession).not.toHaveBeenCalled();
    });

    it('retains a closable failed alternative for the next exact close', async () => {
        const failed = {
            ...sessionFor('playlist-2', 991),
            status: 'error',
            error: 'Process exit was not confirmed',
            canClose: true,
        };
        openResolvedPlayback.mockImplementationOnce(async () => {
            activeSession.set(failed);
            throw new Error('External player process did not exit');
        });

        await expect(
            service.startResolvedPlayback({
                streamUrl: 'https://example.com/alt.mkv',
                title: 'Example Movie',
                contentInfo: failed.contentInfo,
            })
        ).resolves.toBe(false);

        expect(service.matchedExternalPlayback()?.id).toBe(failed.id);

        await service.startResolvedPlayback({
            streamUrl: 'https://example.com/third.mkv',
            title: 'Example Movie',
            contentInfo: {
                playlistId: 'playlist-3',
                contentXtreamId: 992,
                contentType: 'vod',
            },
        });
        expect(closeSession).toHaveBeenCalledWith(failed);
    });

    it('drops a switch that a plain Play overtook', async () => {
        activeSession.set(sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID));
        let releaseClose: (() => void) | undefined;
        const closing = new Promise<void>((resolve) => {
            releaseClose = () => resolve();
        });
        closeSession.mockReturnValue(closing);
        openResolvedPlayback.mockClear();

        const switching = service.startResolvedPlayback({
            streamUrl: 'https://example.com/alt.mkv',
            title: 'Example Movie',
        });

        // The user presses Play on the route copy while that close is pending.
        service.playVod({
            movie_data: {
                stream_id: ROUTE_VOD_ID,
                name: 'Example Movie',
                container_extension: 'mp4',
            },
        } as never);
        releaseClose?.();
        await switching;

        // Only the route copy may be playing; the switch was overtaken.
        expect(openResolvedPlayback).toHaveBeenCalledTimes(1);
        expect(openResolvedPlayback).not.toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'https://example.com/alt.mkv',
            }),
            true
        );

        closeSession.mockResolvedValue(undefined);
    });

    it('drops a plain Play when its initiating route changes during close', async () => {
        activeSession.set(sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID));
        let releaseClose: (() => void) | undefined;
        closeSession.mockReturnValue(
            new Promise<void>((resolve) => {
                releaseClose = resolve;
            })
        );
        openResolvedPlayback.mockClear();
        addRecentItem.mockClear();

        const playing = service.playVod({
            movie_data: {
                stream_id: ROUTE_VOD_ID,
                name: 'First movie',
                container_extension: 'mkv',
            },
        } as never);
        while (closeSession.mock.calls.length === 0) {
            await Promise.resolve();
        }

        routeVodId.set(ROUTE_VOD_ID + 1);
        releaseClose?.();

        await expect(playing).resolves.toBe(false);
        expect(openResolvedPlayback).not.toHaveBeenCalled();
        expect(addRecentItem).not.toHaveBeenCalled();
    });

    it('stops the running external player before switching sources', async () => {
        activeSession.set(sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID));

        await service.startResolvedPlayback({
            streamUrl: 'https://example.com/alt.mkv',
            title: 'Example Movie',
            contentInfo: {
                playlistId: 'playlist-2',
                contentXtreamId: 991,
                contentType: 'vod',
            },
        });

        // A switch REPLACES what is playing. With MPV/VLC and instance reuse
        // off the backend spawns a second detached player otherwise: both
        // sources keep running, and Stop owns only the newer one.
        expect(closeSession).toHaveBeenCalled();
    });
});
