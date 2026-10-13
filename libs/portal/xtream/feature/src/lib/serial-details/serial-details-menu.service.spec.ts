import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import type { SeriesQuickStartAction } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    SERIES_MENU_ACTION,
    type SeasonContainerComponent,
} from '@iptvnator/ui/components';
import { SerialDetailsMenuService } from './serial-details-menu.service';

function quickStart(
    overrides: Partial<SeriesQuickStartAction> = {}
): SeriesQuickStartAction {
    return {
        kind: 'play-next',
        labelKey: 'XTREAM.PLAY_NEXT',
        episodeLabel: 'S01E02',
        icon: 'play_arrow',
        episode: { id: '1002', season: 1, episode_num: 2, title: 'Two' },
        position: null,
        disabled: false,
        ...overrides,
    } as SeriesQuickStartAction;
}

/** A season container whose watched rows are shown and that holds none of them back itself. */
function watchableContainer(): SeasonContainerComponent {
    return {
        seasonWatchBatchRunning: signal(false),
        watchPresenter: {
            seasonWatchToggleVisible: signal(true),
            selectedSeasonFullyWatched: signal(false),
            seasonWatchEligibleCount: signal(2),
            seriesMenuVisible: signal(true),
            seriesFullyWatched: signal(false),
            seriesWatchEligibleCount: signal(3),
            seriesCountKnown: signal(true),
            seriesActionDisabled: signal(false),
        },
        downloadPresenter: {
            presentationVisible: signal(false),
            eligibleEpisodeCount: signal(0),
            seasonDisabled: signal(true),
            batchRunning: signal(false),
        },
    } as unknown as SeasonContainerComponent;
}

describe('SerialDetailsMenuService', () => {
    const quickStartSignal = signal<SeriesQuickStartAction | null>(null);
    const seasonContainer = signal<SeasonContainerComponent | undefined>(
        undefined
    );
    const startPending = signal(false);
    const openEpisodeExternally = jest.fn().mockResolvedValue(undefined);
    const openSnackBar = jest.fn();
    let pageToken: string;
    let service: SerialDetailsMenuService;

    beforeEach(() => {
        quickStartSignal.set(quickStart());
        seasonContainer.set(undefined);
        startPending.set(false);
        pageToken = 'xtream-1:103#1.0';
        openEpisodeExternally.mockClear();
        openSnackBar.mockClear();
        TestBed.configureTestingModule({
            providers: [
                SerialDetailsMenuService,
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist: signal({ id: 'xtream-1' }),
                        loadRecentItems: jest.fn(),
                        serialCategories: signal([]),
                        recentItems: signal([]),
                        constructEpisodeStreamUrl: () =>
                            'http://xtream.example/episode.mp4',
                    },
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
                { provide: MatSnackBar, useValue: { open: openSnackBar } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(SerialDetailsMenuService);
        service.bind({
            selectedItem: signal({
                series_id: 103,
                info: {},
                episodes: {},
            } as never),
            quickStart: quickStartSignal,
            seasonContainer,
            categoryId: signal(''),
            episodePositions: signal(new Map()),
            playbackActive: signal(false),
            startPending,
            resetProgress: jest.fn(),
            pageToken: () => pageToken,
            openEpisodeExternally,
        });
    });

    function rowIds(): string[] {
        return service
            .sections()
            .flatMap((section) => section.items)
            .map((item) => item.id);
    }

    function row(id: string) {
        return service
            .sections()
            .flatMap((section) => section.items)
            .find((item) => item.id === id);
    }

    it('offers the next episode to an external player and to the clipboard', () => {
        expect(rowIds()).toEqual(
            expect.arrayContaining([
                SERIES_MENU_ACTION.ExternalPlayer,
                SERIES_MENU_ACTION.CopyUrl,
            ])
        );
    });

    it('offers no episode rows once the series is completed', async () => {
        // The completed quick start still names the last episode, but it
        // is a label, not something to launch or copy.
        quickStartSignal.set(quickStart({ kind: 'completed', disabled: true }));

        expect(rowIds()).not.toContain(SERIES_MENU_ACTION.ExternalPlayer);
        expect(rowIds()).not.toContain(SERIES_MENU_ACTION.CopyUrl);

        await service.run(SERIES_MENU_ACTION.ExternalPlayer);
        expect(openEpisodeExternally).not.toHaveBeenCalled();
    });

    it.each([
        SERIES_MENU_ACTION.SeasonWatched,
        SERIES_MENU_ACTION.SeriesWatched,
        SERIES_MENU_ACTION.ExternalPlayer,
    ])('holds the %s row while a forced launch has not settled', (id) => {
        seasonContainer.set(watchableContainer());
        expect(row(id)?.disabled).toBe(false);

        // The launching episode has no session yet: a bulk watched action
        // would include it, and another launch would open beside it.
        startPending.set(true);
        expect(row(id)?.disabled).toBe(true);
    });

    describe('a failed external launch', () => {
        let warn: jest.SpyInstance;

        beforeEach(() => {
            warn = jest
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
        });

        afterEach(() => warn.mockRestore());

        it('is reported on the visit that asked for it', async () => {
            openEpisodeExternally.mockRejectedValueOnce(
                new Error('spawn failed')
            );

            await service.run(SERIES_MENU_ACTION.ExternalPlayer);

            expect(openEpisodeExternally).toHaveBeenCalledWith(
                expect.objectContaining({ id: '1002' }),
                'mpv'
            );
            expect(openSnackBar).toHaveBeenCalledWith(
                'PORTALS.PLAYBACK_ERROR',
                undefined,
                { duration: 3000 }
            );
        });

        it('stays quiet once the page shows another visit', async () => {
            openEpisodeExternally.mockImplementationOnce(async () => {
                // The viewer left the series and came back while the
                // launch ran: same series, a new page token.
                pageToken = 'xtream-1:103#1.2';
                throw new Error('spawn failed');
            });

            await service.run(SERIES_MENU_ACTION.ExternalPlayer);

            expect(openEpisodeExternally).toHaveBeenCalledTimes(1);
            expect(openSnackBar).not.toHaveBeenCalled();
        });
    });
});
