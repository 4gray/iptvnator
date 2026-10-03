import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type PlaybackPositionData,
    type XtreamVodDetails,
} from '@iptvnator/shared/interfaces';
import {
    VOD_MENU_ACTION,
    VodDetailsMenuService,
} from './vod-details-menu.service';
import { VodDetailsMultiSourceUiService } from './vod-details-multi-source-ui.service';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';

describe('VodDetailsMenuService', () => {
    const playbackStartPending = signal(false);
    const isExternalLaunchPending = signal(false);
    const hasPlaybackPosition = signal(true);
    const primaryPosition = signal<PlaybackPositionData | null>(null);
    const primaryTarget = signal<{
        playlistId: string;
        contentId: number;
    } | null>({ playlistId: 'playlist-1', contentId: 7 });
    const primaryIsPinnedCopy = signal(false);
    const forgetPinnedPosition = jest.fn();
    const clearPlaybackPositionOrThrow = jest.fn().mockResolvedValue(undefined);
    const discardPendingPositionLoads = jest.fn();
    const loadAllPositions = jest.fn().mockResolvedValue(undefined);
    const routePlaybackPosition = signal<PlaybackPositionData | null>(null);
    const vodPlaybackPosition = signal<PlaybackPositionData | null>(null);
    const openExternal = jest.fn().mockResolvedValue(undefined);
    let service: VodDetailsMenuService;

    beforeEach(() => {
        playbackStartPending.set(false);
        isExternalLaunchPending.set(false);
        primaryPosition.set(null);
        primaryTarget.set({ playlistId: 'playlist-1', contentId: 7 });
        primaryIsPinnedCopy.set(false);
        routePlaybackPosition.set(null);
        vodPlaybackPosition.set(null);
        jest.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [
                VodDetailsMenuService,
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist: signal({ id: 'playlist-1' }),
                        loadAllPositions,
                    },
                },
                {
                    provide: VodDetailsPlaybackService,
                    useValue: {
                        routePlaybackPosition,
                        vodPlaybackPosition,
                        playbackStartPending,
                        isExternalLaunchPending,
                        isExternalStopAction: signal(false),
                        inlinePlayback: signal(null),
                        discardPendingPositionLoads,
                    },
                },
                {
                    provide: VodDetailsMultiSourceUiService,
                    useValue: {
                        hasPlaybackPosition,
                        primaryPosition,
                        primaryTarget,
                        primaryIsPinnedCopy,
                        forgetPinnedPosition,
                    },
                },
                {
                    provide: VodMultiSourceHostService,
                    useValue: {
                        hasAlternatives: signal(false),
                        alternativeCount: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: { clearPlaybackPositionOrThrow },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: true },
                },
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.MPV) },
                },
                { provide: Router, useValue: { navigate: jest.fn() } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(VodDetailsMenuService);
        service.bind({
            item: signal({ info: { name: 'Movie' } } as XtreamVodDetails),
            vodId: signal(7),
            category: signal(null),
            restart: jest.fn(),
            openExternal,
        });
    });

    function row(id: string) {
        return service
            .sections()
            .flatMap((section) => section.items)
            .find((item) => item.id === id);
    }

    it('offers the external player and Start over rows while nothing starts', () => {
        expect(row(VOD_MENU_ACTION.ExternalPlayer)?.disabled).toBeFalsy();
        expect(row(VOD_MENU_ACTION.StartOver)?.disabled).toBeFalsy();
    });

    it('hands the external launch to the host with the configured player', async () => {
        // The host honours a pinned copy and its resume point; the menu
        // must not resolve the route copy on its own.
        await service.run(VOD_MENU_ACTION.ExternalPlayer);
        expect(openExternal).toHaveBeenCalledWith('mpv');
    });

    it('offers and performs the reset for the pinned copy the button acts on', async () => {
        // Only the pinned copy has progress: the hero shows it, so the menu
        // must offer to reset it, and clear THAT row rather than the route's.
        primaryIsPinnedCopy.set(true);
        primaryTarget.set({ playlistId: 'playlist-2', contentId: 991 });
        primaryPosition.set({
            playlistId: 'playlist-2',
            contentXtreamId: 991,
            contentType: 'vod',
            positionSeconds: 2538,
            durationSeconds: 7200,
        });
        expect(row(VOD_MENU_ACTION.ResetProgress)).toBeDefined();

        await service.run(VOD_MENU_ACTION.ResetProgress);

        expect(clearPlaybackPositionOrThrow).toHaveBeenCalledWith(
            'playlist-2',
            991,
            'vod'
        );
        expect(forgetPinnedPosition).toHaveBeenCalledTimes(1);
        expect(discardPendingPositionLoads).not.toHaveBeenCalled();
        expect(vodPlaybackPosition()).toBeNull();
    });

    it('hides the reset while the copy the button acts on has no row', () => {
        routePlaybackPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 7,
            contentType: 'vod',
            positionSeconds: 100,
            durationSeconds: 7200,
        });
        // The route copy's row says nothing about an unwatched pinned copy.
        expect(row(VOD_MENU_ACTION.ResetProgress)).toBeUndefined();
    });

    it('holds both rows while a start resolves or a launch awaits the player', () => {
        // Another start would be refused while one is in flight: an enabled
        // row would close the menu and do nothing.
        playbackStartPending.set(true);
        expect(row(VOD_MENU_ACTION.ExternalPlayer)?.disabled).toBe(true);
        expect(row(VOD_MENU_ACTION.StartOver)?.disabled).toBe(true);

        playbackStartPending.set(false);
        isExternalLaunchPending.set(true);
        expect(row(VOD_MENU_ACTION.ExternalPlayer)?.disabled).toBe(true);
        expect(row(VOD_MENU_ACTION.StartOver)?.disabled).toBe(true);
    });
});
