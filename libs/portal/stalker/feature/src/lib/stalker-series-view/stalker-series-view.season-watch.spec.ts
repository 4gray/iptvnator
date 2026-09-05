import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    StalkerStore,
    mapVodSeriesEpisodes,
    type StalkerMappedEpisode,
    type StalkerVodSource,
    type VodSeriesSeasonVm,
} from '@iptvnator/portal/stalker/data-access';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    CrossPortalSimilarService,
    DownloadsService,
    PlaybackPositionRuntimeBridgeService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { EMPTY, of } from 'rxjs';
import { StalkerCatalogFacadeService } from '../stalker-catalog-facade.service';
import { StalkerSeriesPositionPartialSaveError } from './stalker-series-position-compatibility';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';

const PLAYLIST_ID = 'playlist-1';
const SERIES_A_ID = 100;
const SERIES_B_ID = 200;

function createVodItem(seriesId: number): StalkerVodSource {
    return {
        id: String(seriesId),
        is_series: '1',
        info: {
            name: `Series ${seriesId}`,
            description: 'Lazy series',
            movie_image: 'poster.jpg',
        },
    };
}

function createSeason(
    seriesId: number,
    episodes: VodSeriesSeasonVm['episodes'] = []
): VodSeriesSeasonVm {
    return {
        id: 'season-1',
        video_id: String(seriesId),
        name: 'Season 1',
        season_number: '1',
        episodes,
        isLoading: false,
        isExpanded: false,
    };
}

function createProviderEpisode(id = 'provider-episode-1', episodeNumber = 1) {
    return {
        id,
        series_number: episodeNumber,
        name: episodeNumber === 1 ? 'Pilot' : `Episode ${episodeNumber}`,
    };
}

function createPosition(
    overrides: Partial<PlaybackPositionData> = {}
): PlaybackPositionData {
    return {
        contentXtreamId: 0,
        contentType: 'episode',
        seriesXtreamId: SERIES_A_ID,
        seasonNumber: 1,
        episodeNumber: 1,
        positionSeconds: 40,
        durationSeconds: 100,
        playlistId: PLAYLIST_ID,
        ...overrides,
    };
}

describe('StalkerSeriesViewComponent season watched toggle', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    let repositoryRows: PlaybackPositionData[];
    let repositoryOrder: string[];
    const selectedItem = signal<StalkerVodSource | null>(
        createVodItem(SERIES_A_ID)
    );
    const currentPlaylist = signal<{ _id: string } | null>({
        _id: PLAYLIST_ID,
    });
    const vodSeriesSeasonsResource = signal<unknown[]>([]);
    const getSeriesPlaybackPositions = jest.fn();
    const savePlaybackPosition = jest.fn();
    const clearPlaybackPosition = jest.fn();
    const savePlaybackPositionOrThrow = jest.fn();
    const clearPlaybackPositionOrThrow = jest.fn();
    const refreshPositions = jest.fn();

    async function settle(): Promise<void> {
        for (let pass = 0; pass < 4; pass++) {
            fixture.detectChanges();
            await Promise.resolve();
        }
    }

    async function startWithTwoLoadedEpisodes(): Promise<[number, number]> {
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: String(SERIES_A_ID),
                name: 'Season 1',
                season_number: '1',
            },
        ]);
        await settle();
        fixture.componentInstance.vodSeriesSeasons.set([
            createSeason(SERIES_A_ID, [
                createProviderEpisode(),
                createProviderEpisode('provider-episode-2', 2),
            ]),
        ]);
        await settle();
        const [first, second] = fixture.componentInstance.mappedSeasons()['1'];
        return [Number(first.id), Number(second.id)];
    }

    function seasonToggleRequest(ids: number[], markWatched: boolean) {
        return {
            seasonKey: '1',
            markWatched,
            requests: ids.map((contentXtreamId, index) => ({
                contentXtreamId,
                nextPosition: markWatched
                    ? createPosition({
                          contentXtreamId,
                          episodeNumber: index + 1,
                          positionSeconds: 100,
                      })
                    : null,
            })),
        };
    }

    function snackBarCalls(): unknown[][] {
        return (TestBed.inject(MatSnackBar).open as jest.Mock).mock.calls;
    }

    function expectSeasonToggleSnackbar(key: string): void {
        expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
            key,
            undefined,
            { duration: 5000 }
        );
    }

    beforeEach(async () => {
        repositoryRows = [];
        repositoryOrder = [];
        selectedItem.set(createVodItem(SERIES_A_ID));
        currentPlaylist.set({ _id: PLAYLIST_ID });
        vodSeriesSeasonsResource.set([]);

        getSeriesPlaybackPositions.mockReset();
        getSeriesPlaybackPositions.mockImplementation(
            async (
                _playlistId: string,
                seriesXtreamId: number
            ): Promise<PlaybackPositionData[]> =>
                repositoryRows.filter(
                    (position) => position.seriesXtreamId === seriesXtreamId
                )
        );
        savePlaybackPosition.mockReset();
        savePlaybackPosition.mockImplementation(
            async (
                _playlistId: string,
                position: PlaybackPositionData
            ): Promise<void> => {
                repositoryOrder.push(`save:${position.contentXtreamId}`);
                repositoryRows = repositoryRows.filter(
                    (row) => row.contentXtreamId !== position.contentXtreamId
                );
                repositoryRows.push(position);
            }
        );
        clearPlaybackPosition.mockReset();
        clearPlaybackPosition.mockImplementation(
            async (
                _playlistId: string,
                contentXtreamId: number
            ): Promise<void> => {
                repositoryOrder.push(`clear:${contentXtreamId}`);
                repositoryRows = repositoryRows.filter(
                    (row) => row.contentXtreamId !== contentXtreamId
                );
            }
        );
        savePlaybackPositionOrThrow
            .mockReset()
            .mockImplementation(savePlaybackPosition);
        clearPlaybackPositionOrThrow
            .mockReset()
            .mockImplementation(clearPlaybackPosition);
        refreshPositions.mockReset();
        refreshPositions.mockResolvedValue(undefined);

        await TestBed.configureTestingModule({
            imports: [StalkerSeriesViewComponent],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: {
                        selectedItem,
                        selectedContentType: signal<'series' | 'vod'>('vod'),
                        currentPlaylist,
                        getSerialSeasonsResource: () => [],
                        getVodSeriesSeasonsResource: () =>
                            vodSeriesSeasonsResource(),
                        isVodSeriesSeasonsLoading: signal(false),
                        isSerialSeasonsLoading: signal(false),
                        fetchVodSeriesEpisodes: jest
                            .fn()
                            .mockResolvedValue([createProviderEpisode()]),
                        resolveVodPlayback: jest.fn(),
                        fetchLinkToPlay: jest.fn(),
                        clearSelectedItem: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getSeriesPlaybackPositions,
                        savePlaybackPosition,
                        clearPlaybackPosition,
                        savePlaybackPositionOrThrow,
                        clearPlaybackPositionOrThrow,
                    },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: {
                        onPlaybackPositionUpdate: jest
                            .fn()
                            .mockReturnValue(jest.fn()),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession: signal(null) },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: jest.fn().mockReturnValue(true),
                        openResolvedPlayback: jest.fn(),
                        openExternalPlayback: jest.fn(),
                    },
                },
                {
                    provide: CrossPortalSimilarService,
                    useValue: {
                        isAvailable: false,
                        matchRecommendations: jest.fn(),
                        buildLink: jest.fn(),
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        navigate: jest.fn(),
                        navigateByUrl: jest.fn(),
                    },
                },
                {
                    provide: DownloadsService,
                    useValue: { startDownload: jest.fn() },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => false,
                        getSeason: jest.fn(),
                        getSeasonEpisodes: jest.fn(),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: { open: jest.fn() },
                },
                {
                    provide: StalkerCatalogFacadeService,
                    useValue: { refreshPositions },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                        onDefaultLangChange: EMPTY,
                    },
                },
            ],
        })
            .overrideComponent(StalkerSeriesViewComponent, {
                set: { template: '' },
            })
            .compileComponents();

        fixture = TestBed.createComponent(StalkerSeriesViewComponent);
    });

    afterEach(() => {
        fixture.destroy();
        jest.restoreAllMocks();
    });

    it('ignores an old episode response after navigating to another season slice', async () => {
        await startWithTwoLoadedEpisodes();
        const store = TestBed.inject(StalkerStore);
        let finishOld!: (episodes: VodSeriesSeasonVm['episodes']) => void;
        jest.spyOn(store, 'fetchVodSeriesEpisodes').mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishOld = resolve;
                })
        );
        const oldLoad = fixture.componentInstance.loadEpisodesForSeason(
            fixture.componentInstance.vodSeriesSeasons()[0]
        );
        selectedItem.set({
            ...createVodItem(SERIES_B_ID),
            info: { name: 'Series B s02' },
        });
        vodSeriesSeasonsResource.set([createSeason(SERIES_B_ID)]);
        await settle();
        expect(fixture.componentInstance.quickStartAction()?.episodeLabel).toBe(
            'S02E01'
        );
        finishOld([createProviderEpisode('old-season-episode')]);
        await oldLoad;
        await settle();
        expect(fixture.componentInstance.mappedSeasons()['2']).toEqual([]);
        await fixture.componentInstance.loadEpisodesForSeason(
            fixture.componentInstance.vodSeriesSeasons()[0]
        );
        await settle();
        expect(fixture.componentInstance.mappedSeasons()['2'][0].season).toBe(
            2
        );
    });

    it('marks a season watched sequentially, counting failed legacy cleanup as watched', async () => {
        const [firstId, secondId] = await startWithTwoLoadedEpisodes();
        const loadsBefore = getSeriesPlaybackPositions.mock.calls.length;
        // The second episode saves its scoped row but fails legacy cleanup —
        // that outcome is still a watched episode, not a batch failure.
        savePlaybackPositionOrThrow.mockImplementation(
            async (playlistId: string, position: PlaybackPositionData) => {
                await savePlaybackPosition(playlistId, position);
                if (position.contentXtreamId === secondId) {
                    throw new StalkerSeriesPositionPartialSaveError('cleanup');
                }
            }
        );

        await fixture.componentInstance.handleSeasonPlaybackToggleRequested(
            seasonToggleRequest([firstId, secondId], true)
        );

        expect(repositoryOrder).toEqual([
            `save:${firstId}`,
            `save:${secondId}`,
        ]);
        expect(getSeriesPlaybackPositions.mock.calls.length).toBe(loadsBefore);
        const positions = fixture.componentInstance.episodePlaybackPositions();
        expect(positions.get(secondId)?.positionSeconds).toBe(100);
        expectSeasonToggleSnackbar('XTREAM.SEASON_MARKED_WATCHED');
        // The catalog grid's progress badge source must follow the batch.
        expect(refreshPositions).toHaveBeenCalledWith(PLAYLIST_ID);
        expect(fixture.componentInstance.seasonWatchBatchRunning()).toBe(false);
    });

    it('keeps surviving clears and reports a partial season unwatch failure', async () => {
        const [firstId, secondId] = await startWithTwoLoadedEpisodes();
        repositoryRows = [firstId, secondId].map((contentXtreamId, index) =>
            createPosition({
                contentXtreamId,
                episodeNumber: index + 1,
                positionSeconds: 100,
            })
        );
        selectedItem.set(createVodItem(SERIES_A_ID));
        await settle();
        clearPlaybackPositionOrThrow.mockImplementation(
            async (playlistId: string, contentXtreamId: number) => {
                if (contentXtreamId === secondId) {
                    throw new Error('clear rejected');
                }
                return clearPlaybackPosition(playlistId, contentXtreamId);
            }
        );

        await fixture.componentInstance.handleSeasonPlaybackToggleRequested(
            seasonToggleRequest([firstId, secondId], false)
        );

        const positions = fixture.componentInstance.episodePlaybackPositions();
        expect(positions.has(firstId)).toBe(false);
        expect(positions.get(secondId)?.positionSeconds).toBe(100);
        expectSeasonToggleSnackbar('XTREAM.SEASON_MARKED_UNWATCHED_PARTIAL');
        // A partial success changed rows — the badge refresh still runs.
        expect(refreshPositions).toHaveBeenCalledWith(PLAYLIST_ID);
    });

    it('suppresses feedback when the series changes while the batch drains', async () => {
        const [firstId, secondId] = await startWithTwoLoadedEpisodes();
        const callsBefore = snackBarCalls().length;

        const pending =
            fixture.componentInstance.handleSeasonPlaybackToggleRequested(
                seasonToggleRequest([firstId, secondId], true)
            );
        // The user opens another series before the mutation queue drains.
        selectedItem.set(createVodItem(SERIES_B_ID));
        await pending;

        expect(snackBarCalls().length).toBe(callsBefore);
        expect(fixture.componentInstance.seasonWatchBatchRunning()).toBe(false);
    });

    describe('series scope', () => {
        function createSecondSeason(
            episodes: VodSeriesSeasonVm['episodes'] = []
        ): VodSeriesSeasonVm {
            return {
                id: 'season-2',
                video_id: String(SERIES_A_ID),
                name: 'Season 2',
                season_number: '2',
                episodes,
                isLoading: false,
                isExpanded: false,
            };
        }

        // The real mapper is the oracle for the tracking ids a hydrated
        // season will produce, so legacy rows can be seeded BEFORE the
        // toggle hydrates that season.
        const s2ProviderEpisode = () =>
            createProviderEpisode('provider-episode-s2', 1);
        const s2Mapped = mapVodSeriesEpisodes(
            [createSecondSeason([s2ProviderEpisode()])],
            { parentSeriesId: SERIES_A_ID, fallbackPoster: '' }
        )['2'][0] as StalkerMappedEpisode;
        const S2_SCOPED_ID = Number(s2Mapped.id);
        const S2_LEGACY_ID = Number(s2Mapped.legacyTrackingId);

        function seriesToggleRequest(ids: number[], markWatched: boolean) {
            return {
                markWatched,
                requests: ids.map((contentXtreamId, index) => ({
                    contentXtreamId,
                    nextPosition: markWatched
                        ? createPosition({
                              contentXtreamId,
                              episodeNumber: index + 1,
                              positionSeconds: 100,
                          })
                        : null,
                })),
            };
        }

        async function startWithLazySecondSeason(): Promise<number> {
            vodSeriesSeasonsResource.set([
                {
                    id: 'season-1',
                    video_id: String(SERIES_A_ID),
                    name: 'Season 1',
                    season_number: '1',
                },
            ]);
            await settle();
            fixture.componentInstance.vodSeriesSeasons.set([
                createSeason(SERIES_A_ID, [createProviderEpisode()]),
                createSecondSeason(),
            ]);
            await settle();
            return Number(
                fixture.componentInstance.mappedSeasons()['1'][0].id
            );
        }

        function mockSecondSeasonFetch(): jest.Mock {
            const fetch = TestBed.inject(StalkerStore)
                .fetchVodSeriesEpisodes as jest.Mock;
            fetch.mockResolvedValue([s2ProviderEpisode()]);
            return fetch;
        }

        it('marks every season directly when all seasons are loaded', async () => {
            const [firstId, secondId] = await startWithTwoLoadedEpisodes();

            await fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                seriesToggleRequest([firstId, secondId], true)
            );

            expect(repositoryOrder).toEqual([
                `save:${firstId}`,
                `save:${secondId}`,
            ]);
            expectSeasonToggleSnackbar('XTREAM.SEASON_MARKED_WATCHED');
            expect(refreshPositions).toHaveBeenCalledWith(PLAYLIST_ID);
            expect(
                fixture.componentInstance.seasonWatchBatchRunning()
            ).toBe(false);
        });

        it('hydrates lazy seasons, then marks them with legacy-row cleanup', async () => {
            // A pre-scope legacy row for the NOT-yet-hydrated season 2
            // episode: the sync reconcile after hydration must surface it so
            // the save cleans it up — enqueuing against the effect-fed maps
            // would miss it (the effect only flushes on the next CD tick).
            repositoryRows = [
                createPosition({
                    contentXtreamId: S2_LEGACY_ID,
                    seasonNumber: 2,
                    episodeNumber: 1,
                }),
            ];
            const firstId = await startWithLazySecondSeason();
            const fetch = mockSecondSeasonFetch();

            await fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                seriesToggleRequest([firstId], true)
            );

            expect(fetch).toHaveBeenCalledWith(
                String(SERIES_A_ID),
                'season-2'
            );
            expect(repositoryOrder).toEqual([
                `save:${firstId}`,
                `save:${S2_SCOPED_ID}`,
                `clear:${S2_LEGACY_ID}`,
            ]);
            expect(
                repositoryRows.some(
                    (row) => row.contentXtreamId === S2_LEGACY_ID
                )
            ).toBe(false);
            expectSeasonToggleSnackbar('XTREAM.SEASON_MARKED_WATCHED');
            expect(refreshPositions).toHaveBeenCalledWith(PLAYLIST_ID);
        });

        it('treats an empty portal answer as loaded instead of eternally pending', async () => {
            // The portal ANSWERS for season 2 but reports zero episodes. The
            // season is then loaded-and-empty, not pending: the rest of the
            // series still gets marked, the countless label unblocks, and a
            // follow-up toggle must not re-fetch the empty season.
            const firstId = await startWithLazySecondSeason();
            const fetch = TestBed.inject(StalkerStore)
                .fetchVodSeriesEpisodes as jest.Mock;
            fetch.mockResolvedValue([]);

            await fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                seriesToggleRequest([firstId], true)
            );

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(repositoryOrder).toEqual([`save:${firstId}`]);
            expectSeasonToggleSnackbar('XTREAM.SEASON_MARKED_WATCHED');
            expect(
                fixture.componentInstance.hasUnloadedVodSeasons()
            ).toBe(false);

            // Everything loaded is now watched and nothing is pending — an
            // empty follow-up mark request is a no-op, not another fetch.
            await fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                seriesToggleRequest([], true)
            );
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(repositoryOrder).toEqual([`save:${firstId}`]);
        });

        it('reuses an in-flight tab-click season load instead of duplicating it', async () => {
            const firstId = await startWithLazySecondSeason();
            let releaseFetch!: (episodes: unknown[]) => void;
            const fetch = TestBed.inject(StalkerStore)
                .fetchVodSeriesEpisodes as jest.Mock;
            fetch.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        releaseFetch = resolve;
                    })
            );

            // The user opened the season tab; that load is still on the
            // wire when the series action starts hydrating — it must join
            // the in-flight request, not start a second one whose failure
            // could abort the toggle independently.
            const season2 = fixture.componentInstance.vodSeriesSeasons()[1];
            const tabLoad =
                fixture.componentInstance.loadEpisodesForSeason(season2);
            const pending =
                fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                    seriesToggleRequest([firstId], true)
                );
            releaseFetch([s2ProviderEpisode()]);
            await Promise.all([tabLoad, pending]);

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(repositoryOrder).toEqual([
                `save:${firstId}`,
                `save:${S2_SCOPED_ID}`,
            ]);
            expectSeasonToggleSnackbar('XTREAM.SEASON_MARKED_WATCHED');
        });

        it('aborts with zero writes when hydrating a season fails', async () => {
            const firstId = await startWithLazySecondSeason();
            (
                TestBed.inject(StalkerStore).fetchVodSeriesEpisodes as jest.Mock
            ).mockRejectedValue(new Error('portal down'));

            await fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                seriesToggleRequest([firstId], true)
            );

            expect(repositoryOrder).toEqual([]);
            expectSeasonToggleSnackbar('XTREAM.SERIES_WATCH_UPDATE_FAILED');
            expect(refreshPositions).not.toHaveBeenCalled();
            expect(
                fixture.componentInstance.seasonWatchBatchRunning()
            ).toBe(false);
        });

        it('aborts silently when the series changes during hydration', async () => {
            const firstId = await startWithLazySecondSeason();
            let releaseFetch!: (episodes: unknown[]) => void;
            (
                TestBed.inject(StalkerStore).fetchVodSeriesEpisodes as jest.Mock
            ).mockImplementation(
                () =>
                    new Promise((resolve) => {
                        releaseFetch = resolve;
                    })
            );
            const callsBefore = snackBarCalls().length;

            const pending =
                fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                    seriesToggleRequest([firstId], true)
                );
            selectedItem.set(createVodItem(SERIES_B_ID));
            releaseFetch([s2ProviderEpisode()]);
            await pending;

            expect(repositoryOrder).toEqual([]);
            expect(snackBarCalls().length).toBe(callsBefore);
            expect(
                fixture.componentInstance.seasonWatchBatchRunning()
            ).toBe(false);
        });

        it('reports a zero count when hydration reveals nothing to mark', async () => {
            // Every episode — loaded and hydrated alike — is already
            // watched, but the empty mark request must still be honored
            // (the container cannot know before hydration).
            const firstId = await startWithLazySecondSeason();
            repositoryRows = [
                createPosition({
                    contentXtreamId: firstId,
                    positionSeconds: 100,
                }),
                createPosition({
                    contentXtreamId: S2_SCOPED_ID,
                    seasonNumber: 2,
                    positionSeconds: 100,
                }),
            ];
            selectedItem.set(createVodItem(SERIES_A_ID));
            await settle();
            mockSecondSeasonFetch();
            const writesBefore = repositoryOrder.length;

            await fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                seriesToggleRequest([], true)
            );

            expect(repositoryOrder.length).toBe(writesBefore);
            expectSeasonToggleSnackbar('XTREAM.SEASON_MARKED_WATCHED');
        });

        it('locks the season toggle while hydration is in flight', async () => {
            const firstId = await startWithLazySecondSeason();
            let releaseFetch!: (episodes: unknown[]) => void;
            (
                TestBed.inject(StalkerStore).fetchVodSeriesEpisodes as jest.Mock
            ).mockImplementation(
                () =>
                    new Promise((resolve) => {
                        releaseFetch = resolve;
                    })
            );

            const pending =
                fixture.componentInstance.handleSeriesPlaybackToggleRequested(
                    seriesToggleRequest([firstId], true)
                );
            expect(
                fixture.componentInstance.seasonWatchBatchRunning()
            ).toBe(true);
            // A season toggle during hydration must not enqueue anything.
            await fixture.componentInstance.handleSeasonPlaybackToggleRequested(
                seasonToggleRequest([firstId], true)
            );
            expect(repositoryOrder).toEqual([]);

            releaseFetch([s2ProviderEpisode()]);
            await pending;

            expect(repositoryOrder).toEqual([
                `save:${firstId}`,
                `save:${S2_SCOPED_ID}`,
            ]);
            expect(
                fixture.componentInstance.seasonWatchBatchRunning()
            ).toBe(false);
        });
    });
});
