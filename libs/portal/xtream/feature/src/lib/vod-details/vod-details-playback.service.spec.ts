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
describe('VodDetailsPlaybackService — external session ownership', () => {
    const ROUTE_PLAYLIST = 'playlist-1';
    const ROUTE_VOD_ID = 650020;

    let service: VodDetailsPlaybackService;
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

        TestBed.configureTestingModule({
            providers: [
                VodDetailsPlaybackService,
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist: signal({ id: ROUTE_PLAYLIST }),
                        addRecentItem: jest.fn(),
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
                        onPlaybackPositionUpdate: jest
                            .fn()
                            .mockReturnValue(() => undefined),
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
});
