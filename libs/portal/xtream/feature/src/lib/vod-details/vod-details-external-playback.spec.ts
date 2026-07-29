import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import type {
    PlaybackPositionData,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
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
    /** The bridge callback the service registers at construction. */
    let positionListener: ((data: PlaybackPositionData) => void) | undefined;
    const addRecentItem = jest.fn();
    const activeSession = signal<unknown>(null);
    const closeSession = jest.fn().mockResolvedValue(undefined);
    const openResolvedPlayback = jest.fn();
    const activeSource = signal<PlayerContentInfo | null>(null);

    function sessionFor(playlistId: string, contentXtreamId: number) {
        return {
            player: 'mpv',
            status: 'playing',
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
        positionListener = undefined;
        addRecentItem.mockClear();

        TestBed.configureTestingModule({
            providers: [
                VodDetailsPlaybackService,
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist: signal({ id: ROUTE_PLAYLIST }),
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
                        onPlaybackPositionUpdate: (
                            listener: (data: PlaybackPositionData) => void
                        ) => {
                            positionListener = listener;
                            return () => undefined;
                        },
                    },
                },
            ],
        });

        service = TestBed.inject(VodDetailsPlaybackService);
        service.bind({
            vodId: signal(ROUTE_VOD_ID),
            vodInfo: signal(null),
            activeSource,
        });
    });

    it('closes the alternative it launched, once the badge has moved on', async () => {
        // The controller marks the DESTINATION active before playback is
        // handed over, so by the time the switch reaches the service the
        // running process no longer looks like "ours" — and was left playing
        // beside its replacement.
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

    it('still starts the replacement when closing the old player fails', async () => {
        activeSession.set(sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID));
        closeSession.mockRejectedValue(new Error('close ipc failed'));
        openResolvedPlayback.mockClear();

        await service.startResolvedPlayback({
            streamUrl: 'https://example.com/alt.mkv',
            title: 'Example Movie',
        });

        // The switch is already committed — the badge names the new source.
        // Bailing out here left the page claiming a source with nothing
        // started at all.
        expect(openResolvedPlayback).toHaveBeenCalledTimes(1);

        closeSession.mockResolvedValue(undefined);
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
            movie_data: { stream_id: ROUTE_VOD_ID, name: 'Example Movie' },
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
