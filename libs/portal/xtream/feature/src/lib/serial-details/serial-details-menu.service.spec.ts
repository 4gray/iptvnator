import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import type { SeriesQuickStartAction } from '@iptvnator/portal/shared/util';
import {
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
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
    const recentItemsSignal = signal<{ type: string; xtream_id: number }[]>([]);
    const episodePositionsSignal = signal(
        new Map<number, PlaybackPositionData>()
    );
    const episodesSignal = signal<Record<string, unknown[]>>({});
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
        recentItemsSignal.set([]);
        episodePositionsSignal.set(new Map());
        episodesSignal.set({});
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
                        recentItems: recentItemsSignal,
                        constructEpisodeStreamUrl: () =>
                            'http://xtream.example/episode.mp4',
                    },
                },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: {
                        removeRecentItem: jest.fn(),
                        getContentByXtreamId: jest
                            .fn()
                            .mockResolvedValue({ id: 103 }),
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
            selectedItem: computed(
                () =>
                    ({
                        series_id: 103,
                        info: {},
                        episodes: episodesSignal(),
                    }) as never
            ),
            quickStart: quickStartSignal,
            seasonContainer,
            categoryId: signal(''),
            episodePositions: episodePositionsSignal,
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

    describe('Hide from Continue Watching', () => {
        const watched = (
            contentXtreamId: number,
            updatedAt = '2026-10-04T08:00:00Z'
        ): [number, PlaybackPositionData] => [
            contentXtreamId,
            {
                contentXtreamId,
                contentType: 'episode',
                seriesXtreamId: 103,
                // Stopped during the credits: 55 s left.
                positionSeconds: 1887,
                durationSeconds: 1942,
                updatedAt,
            },
        ];
        const episode = (id: number, episodeNum: number) => ({
            id: String(id),
            season: 1,
            episode_num: episodeNum,
            title: `Episode ${episodeNum}`,
        });

        beforeEach(() => {
            recentItemsSignal.set([{ type: 'series', xtream_id: 103 }]);
            episodesSignal.set({
                '1': [episode(1001, 1), episode(1002, 2), episode(1003, 3)],
            });
        });

        it('removes only the typed series when hiding it from Continue Watching', async () => {
            await service.run(SERIES_MENU_ACTION.HideFromContinueWatching);

            expect(
                TestBed.inject(XTREAM_DATA_SOURCE).getContentByXtreamId
            ).toHaveBeenCalledWith(103, 'xtream-1', 'series');
            expect(
                TestBed.inject(XTREAM_DATA_SOURCE).removeRecentItem
            ).toHaveBeenCalledWith({ id: 103, type: 'series' }, 'xtream-1');
        });

        it('is offered once an episode is finished while the next one remains, as the rail lists the series with it', () => {
            episodePositionsSignal.set(new Map([watched(1001)]));

            expect(rowIds()).toContain(
                SERIES_MENU_ACTION.HideFromContinueWatching
            );
        });

        it('is not offered once every episode is watched, as the rail no longer lists the series', () => {
            episodePositionsSignal.set(
                new Map([watched(1001), watched(1002), watched(1003)])
            );
            quickStartSignal.set(
                quickStart({ kind: 'completed', disabled: true })
            );

            expect(rowIds()).not.toContain(
                SERIES_MENU_ACTION.HideFromContinueWatching
            );
        });

        it('is not offered once the run is watched, even with an extra watched after it', () => {
            const extra = (id: number, episodeNum: number) => ({
                ...episode(id, episodeNum),
                season: 0,
            });
            episodesSignal.set({
                '0': [extra(1090, 1), extra(1091, 2)],
                '1': [episode(1001, 1), episode(1002, 2), episode(1003, 3)],
            });
            episodePositionsSignal.set(
                new Map([
                    watched(1001),
                    watched(1002),
                    watched(1003),
                    watched(1090, '2026-10-05T08:00:00Z'),
                ])
            );

            expect(rowIds()).not.toContain(
                SERIES_MENU_ACTION.HideFromContinueWatching
            );
        });

        it('is not offered once the last episode is watched, though the page still offers one skipped before it', () => {
            episodePositionsSignal.set(
                new Map([
                    watched(1001, '2026-10-03T08:00:00Z'),
                    watched(1003, '2026-10-04T08:00:00Z'),
                ])
            );
            // Quick start names episode 2, the one skipped.
            quickStartSignal.set(quickStart({ kind: 'play-next' }));

            expect(rowIds()).not.toContain(
                SERIES_MENU_ACTION.HideFromContinueWatching
            );
            expect(rowIds()).toContain(SERIES_MENU_ACTION.ExternalPlayer);
        });
    });
});
