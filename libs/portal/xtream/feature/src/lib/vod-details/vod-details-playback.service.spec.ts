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
describe('VodDetailsPlaybackService — external session ownership', () => {
    const ROUTE_PLAYLIST = 'playlist-1';
    const ROUTE_VOD_ID = 650020;

    let service: VodDetailsPlaybackService;
    /** The bridge callback the service registers at construction. */
    let positionListener: ((data: PlaybackPositionData) => void) | undefined;
    const addRecentItem = jest.fn();
    const activeSession = signal<unknown>(null);
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
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession, closeSession: jest.fn() },
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
                        openResolvedPlayback: jest.fn(),
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

    it('owns a session launched for the route’s own stream', () => {
        activeSession.set(sessionFor(ROUTE_PLAYLIST, ROUTE_VOD_ID));

        expect(service.matchedExternalPlayback()).not.toBeNull();
        expect(service.isExternalStopAction()).toBe(true);
    });

    it('owns a session launched for the alternative it switched to', () => {
        // Same movie, other playlist, other stream id. Before this the page
        // disowned its own session: the button never became Stop, stopping
        // found nothing to stop, and another click opened a second player.
        activeSource.set({
            playlistId: 'playlist-2',
            contentXtreamId: 991,
            contentType: 'vod',
        });
        activeSession.set(sessionFor('playlist-2', 991));

        expect(service.matchedExternalPlayback()).not.toBeNull();
        expect(service.isExternalStopAction()).toBe(true);
    });

    it('disowns a session belonging to some other movie entirely', () => {
        activeSource.set({
            playlistId: 'playlist-2',
            contentXtreamId: 991,
            contentType: 'vod',
        });
        activeSession.set(sessionFor('playlist-3', 12345));

        expect(service.matchedExternalPlayback()).toBeNull();
        expect(service.isExternalStopAction()).toBe(false);
    });

    it('disowns an alternative session once playback moved back', () => {
        activeSession.set(sessionFor('playlist-2', 991));

        // No active alternative: the switch was undone, so that session is
        // no longer this page's to stop.
        expect(service.matchedExternalPlayback()).toBeNull();
    });

    it('records a source started through multi-source as recently viewed', () => {
        // Playing an alternative from the picker, or letting a pin decide the
        // primary Play, is still watching the movie — it belongs in Recently
        // Viewed exactly as an ordinary Play does.
        service.startResolvedPlayback({
            streamUrl: 'https://example.com/alt.mkv',
            title: 'Example Movie',
            contentInfo: {
                playlistId: 'playlist-2',
                contentXtreamId: 991,
                contentType: 'vod',
            },
        });

        expect(addRecentItem).toHaveBeenCalled();
    });

    it('gives up on a resume point the source cannot reach', () => {
        // Carrying a two-hour position into a 90-minute cut: the engine can
        // never report that time, so latching on it would suppress every save
        // for the whole session and keep re-reporting the impossible start.
        service.inlinePlayback.set({
            streamUrl: 'https://example.com/short-cut.mkv',
            title: 'Example Movie',
            startTime: 7200,
            contentInfo: {
                playlistId: ROUTE_PLAYLIST,
                contentXtreamId: ROUTE_VOD_ID,
                contentType: 'vod',
            },
        });

        expect(
            service.handleInlineTimeUpdate({ currentTime: 12, duration: 5400 })
        ).toBe(true);
    });

    it('still waits for a resume point the source can reach', () => {
        service.inlinePlayback.set({
            streamUrl: 'https://example.com/full.mkv',
            title: 'Example Movie',
            startTime: 2538,
            contentInfo: {
                playlistId: ROUTE_PLAYLIST,
                contentXtreamId: ROUTE_VOD_ID,
                contentType: 'vod',
            },
        });

        expect(
            service.handleInlineTimeUpdate({ currentTime: 12, duration: 7744 })
        ).toBe(false);
    });

    describe('position updates from the bridge', () => {
        function emit(playlistId: string, contentXtreamId: number, at: number) {
            positionListener?.({
                playlistId,
                contentXtreamId,
                contentType: 'vod',
                positionSeconds: at,
                durationSeconds: 7744,
            });
        }

        it('keeps the route’s own resume point when an alternative plays', () => {
            activeSource.set({
                playlistId: 'playlist-2',
                contentXtreamId: 991,
                contentType: 'vod',
            });

            // An alternative's position arrives under ITS ids. Letting it stand in
            // for the route copy's row would have Resume start the route stream at
            // a timecode nobody ever reached in it.
            emit('playlist-2', 991, 4200);

            expect(service.vodPlaybackPosition()?.positionSeconds).toBe(4200);
            expect(service.routePlaybackPosition()).toBeNull();
            expect(service.hasPlaybackPosition()).toBe(false);

            emit(ROUTE_PLAYLIST, ROUTE_VOD_ID, 60);
            expect(service.routePlaybackPosition()?.positionSeconds).toBe(60);
        });

        it('takes the route stream’s progress', () => {
            emit(ROUTE_PLAYLIST, ROUTE_VOD_ID, 120);

            expect(service.vodPlaybackPosition()?.positionSeconds).toBe(120);
        });

        it('takes the progress of the alternative it switched to', () => {
            activeSource.set({
                playlistId: 'playlist-2',
                contentXtreamId: 991,
                contentType: 'vod',
            });

            // An external player running an alternative reports under THAT
            // playlist's ids. Dropping these leaves the resume point where
            // playback started, and a later switch rewinds the whole session.
            emit('playlist-2', 991, 3600);

            expect(service.vodPlaybackPosition()?.positionSeconds).toBe(3600);
        });

        it('ignores progress for a movie this page is not showing', () => {
            emit('playlist-3', 12345, 900);

            expect(service.vodPlaybackPosition()).toBeNull();
        });
    });
});
