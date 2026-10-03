import { computed, signal } from '@angular/core';
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
    const pendingResets = signal<
        readonly { playlistId: string; contentId: number }[]
    >([]);
    const resetPending = computed(() => pendingResets().length > 0);
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
        pendingResets.set([]);
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
                        pendingResets,
                        resetPending,
                        startBlocked: computed(
                            () => isExternalLaunchPending() || resetPending()
                        ),
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

    it('holds every start while the reset is still writing', async () => {
        primaryPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 7,
            contentType: 'vod',
            positionSeconds: 2538,
            durationSeconds: 7200,
        });
        let finishClear: () => void = () => undefined;
        clearPlaybackPositionOrThrow.mockImplementationOnce(
            () => new Promise<void>((resolve) => (finishClear = resolve))
        );

        const reset = service.run(VOD_MENU_ACTION.ResetProgress);
        // A start made now would resume from the row being cleared.
        expect(pendingResets()).toEqual([
            { playlistId: 'playlist-1', contentId: 7 },
        ]);
        expect(row(VOD_MENU_ACTION.ExternalPlayer)?.disabled).toBe(true);
        expect(row(VOD_MENU_ACTION.StartOver)?.disabled).toBe(true);
        expect(row(VOD_MENU_ACTION.ResetProgress)?.disabled).toBe(true);

        finishClear();
        await reset;
        expect(pendingResets()).toEqual([]);
        expect(row(VOD_MENU_ACTION.ExternalPlayer)?.disabled).toBe(false);
    });

    it('keeps an earlier reset pending while a later one finishes first', async () => {
        const clears: Array<() => void> = [];
        clearPlaybackPositionOrThrow.mockImplementation(
            () => new Promise<void>((resolve) => clears.push(resolve))
        );
        primaryPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 7,
            contentType: 'vod',
            positionSeconds: 2538,
            durationSeconds: 7200,
        });

        // Movie A's reset, then the page moves on to B and resets it too.
        const resetA = service.run(VOD_MENU_ACTION.ResetProgress);
        primaryTarget.set({ playlistId: 'playlist-1', contentId: 8 });
        const resetB = service.run(VOD_MENU_ACTION.ResetProgress);
        expect(pendingResets()).toEqual([
            { playlistId: 'playlist-1', contentId: 7 },
            { playlistId: 'playlist-1', contentId: 8 },
        ]);

        // B's write lands first: A is still being cleared, so coming back
        // to A must still hold its starts.
        clears[1]();
        await resetB;
        expect(pendingResets()).toEqual([
            { playlistId: 'playlist-1', contentId: 7 },
        ]);

        clears[0]();
        await resetA;
        expect(pendingResets()).toEqual([]);
        clearPlaybackPositionOrThrow.mockResolvedValue(undefined);
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
