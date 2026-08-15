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
import { StalkerSeriesPositionPartialSaveError } from './stalker-series-position-compatibility';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';
const PLAYLIST_ID = 'playlist-1';
const SECOND_PLAYLIST_ID = 'playlist-2';
const SERIES_A_ID = 100;
const SERIES_B_ID = 200;
const SCOPED_A_ID = 604391373;
const LEGACY_ID = 624320047;
const REGULAR_ID = 91189090;
interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}
function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}
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
function createRegularItem(seriesId: number): StalkerVodSource {
    return {
        id: String(seriesId),
        cmd: `/media/file_${seriesId}.mpg`,
        info: {
            name: `Regular Series ${seriesId}`,
            description: 'Regular series',
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
function createProviderEpisode(
    id = 'provider-episode-1',
    episodeNumber = 1
) {
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
        contentXtreamId: SCOPED_A_ID,
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
describe('StalkerSeriesViewComponent position compatibility', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    let repositoryRows: PlaybackPositionData[];
    let repositoryOrder: string[];
    let runtimePositionListener:
        | ((position: PlaybackPositionData) => void)
        | undefined;
    const selectedContentType = signal<'series' | 'vod'>('vod');
    const selectedItem = signal<StalkerVodSource | null>(
        createVodItem(SERIES_A_ID)
    );
    const currentPlaylist = signal<{ _id: string } | null>({
        _id: PLAYLIST_ID,
    });
    const serialSeasonsResource = signal<unknown[]>([]);
    const vodSeriesSeasonsResource = signal<unknown[]>([]);
    const fetchVodSeriesEpisodes = jest.fn();
    const getSeriesPlaybackPositions = jest.fn();
    const savePlaybackPosition = jest.fn();
    const clearPlaybackPosition = jest.fn();
    const savePlaybackPositionOrThrow = jest.fn();
    const clearPlaybackPositionOrThrow = jest.fn();
    const onPlaybackPositionUpdate = jest.fn();
    async function settle(): Promise<void> {
        for (let pass = 0; pass < 4; pass++) {
            fixture.detectChanges();
            await Promise.resolve();
        }
    }
    async function startWithLoadedEpisode(
        seriesId = SERIES_A_ID
    ): Promise<number> {
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: String(seriesId),
                name: 'Season 1',
                season_number: '1',
            },
        ]);
        await settle();
        fixture.componentInstance.vodSeriesSeasons.set([
            createSeason(seriesId, [createProviderEpisode()]),
        ]);
        await settle();
        return Number(fixture.componentInstance.mappedSeasons()['1'][0].id);
    }
    async function startPendingTwoEpisodeLoad(): Promise<{
        firstPosition: PlaybackPositionData;
        pendingLoad: Deferred<PlaybackPositionData[]>;
        secondPosition: PlaybackPositionData;
    }> {
        const [firstId, secondId] = await startWithTwoLoadedEpisodes();
        const firstPosition = createPosition({
            contentXtreamId: firstId,
            positionSeconds: 15,
        });
        const secondPosition = createPosition({
            contentXtreamId: secondId,
            episodeNumber: 2,
            positionSeconds: 25,
        });
        repositoryRows = [firstPosition, secondPosition];
        const pendingLoad = createDeferred<PlaybackPositionData[]>();
        getSeriesPlaybackPositions.mockImplementationOnce(
            () => pendingLoad.promise
        );
        selectedItem.set(createVodItem(SERIES_A_ID));
        await settle();
        return { firstPosition, pendingLoad, secondPosition };
    }
    beforeEach(async () => {
        repositoryRows = [];
        repositoryOrder = [];
        runtimePositionListener = undefined;
        selectedContentType.set('vod');
        selectedItem.set(createVodItem(SERIES_A_ID));
        currentPlaylist.set({ _id: PLAYLIST_ID });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([]);

        fetchVodSeriesEpisodes.mockReset();
        fetchVodSeriesEpisodes.mockResolvedValue([createProviderEpisode()]);
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
        onPlaybackPositionUpdate.mockReset();
        onPlaybackPositionUpdate.mockImplementation(
            (
                listener: (position: PlaybackPositionData) => void
            ) => {
                runtimePositionListener = listener;
                return jest.fn();
            }
        );

        await TestBed.configureTestingModule({
            imports: [StalkerSeriesViewComponent],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: {
                        selectedItem,
                        selectedContentType,
                        currentPlaylist,
                        getSerialSeasonsResource: () =>
                            serialSeasonsResource(),
                        getVodSeriesSeasonsResource: () =>
                            vodSeriesSeasonsResource(),
                        isVodSeriesSeasonsLoading: signal(false),
                        isSerialSeasonsLoading: signal(false),
                        fetchVodSeriesEpisodes,
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
                        onPlaybackPositionUpdate,
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal(null),
                    },
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
                    useValue: {
                        startDownload: jest.fn(),
                    },
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
                    useValue: {
                        open: jest.fn(),
                    },
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
                set: {
                    template: '',
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(StalkerSeriesViewComponent);
    });

    afterEach(() => {
        fixture.destroy();
        jest.restoreAllMocks();
    });

    it('reconciles positions that arrive before lazy episodes', async () => {
        repositoryRows = [
            createPosition({
                contentXtreamId: LEGACY_ID,
                positionSeconds: 33,
            }),
        ];
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: String(SERIES_A_ID),
                name: 'Season 1',
                season_number: '1',
            },
        ]);

        await settle();

        expect(
            fixture.componentInstance.episodePlaybackPositions().size
        ).toBe(0);
        const season = fixture.componentInstance.vodSeriesSeasons()[0];
        await fixture.componentInstance.loadEpisodesForSeason(season);
        await settle();

        expect(
            Number(
                fixture.componentInstance.mappedSeasons()['1'][0].id
            )
        ).toBe(SCOPED_A_ID);
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toEqual(
            expect.objectContaining({
                contentXtreamId: SCOPED_A_ID,
                positionSeconds: 33,
                seriesXtreamId: SERIES_A_ID,
                seasonNumber: 1,
                episodeNumber: 1,
            })
        );
    });

    it('keeps exact progress while retaining legacy cleanup metadata for watched saves', async () => {
        const exactPosition = createPosition({ positionSeconds: 88 });
        repositoryRows = [
            createPosition({
                contentXtreamId: LEGACY_ID,
                positionSeconds: 22,
            }),
            exactPosition,
        ];
        await startWithLoadedEpisode();

        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(exactPosition);

        const watchedPosition = createPosition({
            positionSeconds: 100,
            durationSeconds: 100,
        });
        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: SCOPED_A_ID,
            nextPosition: watchedPosition,
        });
        await settle();

        expect(repositoryOrder).toEqual([
            `save:${SCOPED_A_ID}`,
            `clear:${LEGACY_ID}`,
        ]);
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(watchedPosition);

        const seasons = fixture.componentInstance.vodSeriesSeasons();
        fixture.componentInstance.vodSeriesSeasons.set(
            seasons.map((season) => ({
                ...season,
                episodes: [...season.episodes],
            }))
        );
        await settle();
        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: SCOPED_A_ID,
            nextPosition: createPosition({ positionSeconds: 99 }),
        });
        expect(
            repositoryOrder.filter(
                (entry) => entry === `clear:${LEGACY_ID}`
            )
        ).toHaveLength(1);
    });

    it('publishes a partial save and retries the same legacy cleanup', async () => {
        repositoryRows = [
            createPosition({
                contentXtreamId: LEGACY_ID,
                positionSeconds: 22,
            }),
        ];
        await startWithLoadedEpisode();
        const clearError = new Error('clear failed');
        clearPlaybackPosition.mockRejectedValueOnce(clearError);
        const newerPosition = createPosition({ positionSeconds: 70 });

        await expect(
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: newerPosition,
            })
        ).rejects.toEqual(
            expect.objectContaining({
                cause: clearError,
                scopedPositionSaved: true,
            })
        );
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(newerPosition);

        const latestPosition = createPosition({ positionSeconds: 80 });
        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: SCOPED_A_ID,
            nextPosition: latestPosition,
        });

        expect(
            clearPlaybackPosition.mock.calls.map(
                ([, contentXtreamId]) => contentXtreamId
            )
        ).toEqual([LEGACY_ID, LEGACY_ID]);
        expect(repositoryRows).toEqual([latestPosition]);
    });

    it('keeps legacy progress when the strict UI save rejects', async () => {
        const legacyPosition = createPosition({
            contentXtreamId: LEGACY_ID,
            positionSeconds: 22,
        });
        repositoryRows = [legacyPosition];
        await startWithLoadedEpisode();
        savePlaybackPositionOrThrow.mockRejectedValueOnce(new Error('fail'));
        const errorLog = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        expect(
            fixture.componentInstance.handlePlaybackToggleRequestedFromUi({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: createPosition({ positionSeconds: 70 }),
            })
        ).toBeUndefined();
        await settle();
        await fixture.whenStable();
        expect(errorLog).toHaveBeenCalled();
        expect(clearPlaybackPositionOrThrow).not.toHaveBeenCalled();
        expect(
            fixture.componentInstance.episodePlaybackPositions()
                .get(SCOPED_A_ID)?.positionSeconds
        ).toBe(22);
    });

    it('ignores a deferred series-A response after selection changes to series B', async () => {
        const seriesAResponse = createDeferred<
            PlaybackPositionData[]
        >();
        const seriesBLegacy = createPosition({
            contentXtreamId: LEGACY_ID,
            seriesXtreamId: SERIES_B_ID,
            positionSeconds: 77,
        });
        getSeriesPlaybackPositions.mockImplementation(
            (
                _playlistId: string,
                seriesXtreamId: number
            ): Promise<PlaybackPositionData[]> =>
                seriesXtreamId === SERIES_A_ID
                    ? seriesAResponse.promise
                    : Promise.resolve([seriesBLegacy])
        );

        await settle();
        selectedItem.set(createVodItem(SERIES_B_ID));
        await settle();
        fixture.componentInstance.vodSeriesSeasons.set([
            createSeason(SERIES_B_ID, [createProviderEpisode()]),
        ]);
        await settle();
        const scopedSeriesBId = Number(
            fixture.componentInstance.mappedSeasons()['1'][0].id
        );

        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(scopedSeriesBId)?.positionSeconds
        ).toBe(77);

        seriesAResponse.resolve([
            createPosition({
                contentXtreamId: LEGACY_ID,
                positionSeconds: 11,
            }),
        ]);
        await settle();

        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(scopedSeriesBId)?.positionSeconds
        ).toBe(77);
        expect(
            fixture.componentInstance.episodePlaybackPositions().size
        ).toBe(1);
    });

    it('clears the previous playlist progress when the same series ID is selected', async () => {
        repositoryRows = [
            createPosition({
                contentXtreamId: LEGACY_ID,
                positionSeconds: 55,
            }),
        ];
        getSeriesPlaybackPositions.mockImplementation(
            async (
                playlistId: string,
                seriesXtreamId: number
            ): Promise<PlaybackPositionData[]> =>
                playlistId === PLAYLIST_ID
                    ? repositoryRows.filter(
                          (position) =>
                              position.seriesXtreamId ===
                              seriesXtreamId
                      )
                    : []
        );
        await startWithLoadedEpisode();

        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)?.positionSeconds
        ).toBe(55);

        currentPlaylist.set({ _id: 'playlist-2' });
        await settle();

        expect(
            fixture.componentInstance.episodePlaybackPositions().size
        ).toBe(0);
        expect(getSeriesPlaybackPositions).toHaveBeenLastCalledWith(
            SECOND_PLAYLIST_ID,
            SERIES_A_ID
        );
    });

    it('does not publish a deferred save after the playlist context switches away and back', async () => {
        const saveCompletion = createDeferred<void>();
        const initialPosition = createPosition({ positionSeconds: 15 });
        const secondPlaylistPosition = createPosition({
            playlistId: SECOND_PLAYLIST_ID,
            positionSeconds: 80,
        });
        const reloadedPosition = createPosition({ positionSeconds: 95 });
        let firstPlaylistLoads = 0;
        getSeriesPlaybackPositions.mockImplementation(
            async (playlistId: string): Promise<PlaybackPositionData[]> => {
                if (playlistId === SECOND_PLAYLIST_ID) {
                    return [secondPlaylistPosition];
                }
                firstPlaylistLoads++;
                return [
                    firstPlaylistLoads === 1
                        ? initialPosition
                        : reloadedPosition,
                ];
            }
        );
        savePlaybackPosition.mockImplementation(async () => {
            await saveCompletion.promise;
        });
        await startWithLoadedEpisode();

        const pendingSave =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: createPosition({ positionSeconds: 60 }),
            });
        await Promise.resolve();
        currentPlaylist.set({ _id: SECOND_PLAYLIST_ID });
        await settle();
        currentPlaylist.set({ _id: PLAYLIST_ID });
        await settle();
        const loadsBeforeSaveCompleted = firstPlaylistLoads;

        saveCompletion.resolve();
        await pendingSave;
        await settle();

        expect(loadsBeforeSaveCompleted).toBe(1);
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(reloadedPosition);
    });

    it('does not publish a deferred clear after the playlist context switches away and back', async () => {
        const clearCompletion = createDeferred<void>();
        const initialPosition = createPosition({ positionSeconds: 15 });
        const secondPlaylistPosition = createPosition({
            playlistId: SECOND_PLAYLIST_ID,
            positionSeconds: 80,
        });
        const reloadedPosition = createPosition({ positionSeconds: 95 });
        let firstPlaylistLoads = 0;
        getSeriesPlaybackPositions.mockImplementation(
            async (playlistId: string): Promise<PlaybackPositionData[]> => {
                if (playlistId === SECOND_PLAYLIST_ID) {
                    return [secondPlaylistPosition];
                }
                firstPlaylistLoads++;
                return [
                    firstPlaylistLoads === 1
                        ? initialPosition
                        : reloadedPosition,
                ];
            }
        );
        clearPlaybackPosition.mockImplementation(async () => {
            await clearCompletion.promise;
        });
        await startWithLoadedEpisode();

        const pendingClear =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: null,
            });
        await Promise.resolve();
        currentPlaylist.set({ _id: SECOND_PLAYLIST_ID });
        await settle();
        currentPlaylist.set({ _id: PLAYLIST_ID });
        await settle();
        const loadsBeforeClearCompleted = firstPlaylistLoads;

        clearCompletion.resolve();
        await pendingClear;
        await settle();

        expect(loadsBeforeClearCompleted).toBe(1);
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(reloadedPosition);
    });

    it('does not publish a deferred save after the playlist signal changes before the context effect', async () => {
        const saveCompletion = createDeferred<void>();
        const initialPosition = createPosition({ positionSeconds: 15 });
        repositoryRows = [initialPosition];
        savePlaybackPosition.mockImplementation(async () => {
            await saveCompletion.promise;
        });
        await startWithLoadedEpisode();

        const pendingSave =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: createPosition({ positionSeconds: 60 }),
            });
        await Promise.resolve();
        currentPlaylist.set({ _id: SECOND_PLAYLIST_ID });
        saveCompletion.resolve();
        await pendingSave;

        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(initialPosition);
    });

    it('does not publish a deferred clear after the series signal changes before the context effect', async () => {
        const clearCompletion = createDeferred<void>();
        const initialPosition = createPosition({ positionSeconds: 15 });
        repositoryRows = [initialPosition];
        clearPlaybackPosition.mockImplementation(async () => {
            await clearCompletion.promise;
        });
        await startWithLoadedEpisode();

        const pendingClear =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: null,
            });
        await Promise.resolve();
        selectedItem.set(createVodItem(SERIES_B_ID));
        clearCompletion.resolve();
        await pendingClear;

        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(initialPosition);
    });

    it('serializes a slow save before a later clear so the clear wins', async () => {
        const saveCompletion = createDeferred<void>();
        const initialPosition = createPosition({ positionSeconds: 15 });
        const savedPosition = createPosition({ positionSeconds: 60 });
        repositoryRows = [initialPosition];
        savePlaybackPosition.mockImplementation(
            async (
                _playlistId: string,
                position: PlaybackPositionData
            ): Promise<void> => {
                repositoryOrder.push('save:start');
                await saveCompletion.promise;
                repositoryRows = repositoryRows.filter(
                    (row) =>
                        row.contentXtreamId !==
                        position.contentXtreamId
                );
                repositoryRows.push(position);
                repositoryOrder.push('save:end');
            }
        );
        clearPlaybackPosition.mockImplementation(
            async (
                _playlistId: string,
                contentXtreamId: number
            ): Promise<void> => {
                repositoryOrder.push('clear');
                repositoryRows = repositoryRows.filter(
                    (row) => row.contentXtreamId !== contentXtreamId
                );
            }
        );
        await startWithLoadedEpisode();

        const pendingSave =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: savedPosition,
            });
        await Promise.resolve();
        const pendingClear =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: null,
            });
        await Promise.resolve();
        saveCompletion.resolve();
        await Promise.all([pendingSave, pendingClear]);
        await settle();

        expect(repositoryOrder).toEqual([
            'save:start',
            'save:end',
            'clear',
        ]);
        expect(repositoryRows).toEqual([]);
        expect(
            fixture.componentInstance.episodePlaybackPositions().size
        ).toBe(0);
    });

    it('serializes a slow clear before a later save so the save wins', async () => {
        const clearCompletion = createDeferred<void>();
        const initialPosition = createPosition({ positionSeconds: 15 });
        const savedPosition = createPosition({ positionSeconds: 70 });
        repositoryRows = [initialPosition];
        clearPlaybackPosition.mockImplementation(
            async (
                _playlistId: string,
                contentXtreamId: number
            ): Promise<void> => {
                repositoryOrder.push('clear:start');
                await clearCompletion.promise;
                repositoryRows = repositoryRows.filter(
                    (row) => row.contentXtreamId !== contentXtreamId
                );
                repositoryOrder.push('clear:end');
            }
        );
        savePlaybackPosition.mockImplementation(
            async (
                _playlistId: string,
                position: PlaybackPositionData
            ): Promise<void> => {
                repositoryOrder.push('save');
                repositoryRows = repositoryRows.filter(
                    (row) =>
                        row.contentXtreamId !==
                        position.contentXtreamId
                );
                repositoryRows.push(position);
            }
        );
        await startWithLoadedEpisode();

        const pendingClear =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: null,
            });
        await Promise.resolve();
        const pendingSave =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: SCOPED_A_ID,
                nextPosition: savedPosition,
            });
        await Promise.resolve();
        clearCompletion.resolve();
        await Promise.all([pendingClear, pendingSave]);
        await settle();

        expect(repositoryOrder).toEqual([
            'clear:start',
            'clear:end',
            'save',
        ]);
        expect(repositoryRows).toEqual([savedPosition]);
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(savedPosition);
    });

    it('does not let a load started before a save overwrite the saved position', async () => {
        const staleLoad = createDeferred<PlaybackPositionData[]>();
        const initialPosition = createPosition({ positionSeconds: 15 });
        const savedPosition = createPosition({ positionSeconds: 70 });
        repositoryRows = [initialPosition];
        await startWithLoadedEpisode();
        getSeriesPlaybackPositions.mockImplementationOnce(
            () => staleLoad.promise
        );

        selectedItem.set(createVodItem(SERIES_A_ID));
        await settle();
        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: SCOPED_A_ID,
            nextPosition: savedPosition,
        });
        await settle();
        staleLoad.resolve([initialPosition]);
        await settle();

        expect(repositoryRows).toEqual([savedPosition]);
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(savedPosition);
    });

    it('does not let a load started before a clear resurrect the cleared position', async () => {
        const staleLoad = createDeferred<PlaybackPositionData[]>();
        const initialPosition = createPosition({ positionSeconds: 15 });
        repositoryRows = [initialPosition];
        await startWithLoadedEpisode();
        getSeriesPlaybackPositions.mockImplementationOnce(
            () => staleLoad.promise
        );

        selectedItem.set(createVodItem(SERIES_A_ID));
        await settle();
        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: SCOPED_A_ID,
            nextPosition: null,
        });
        await settle();
        staleLoad.resolve([initialPosition]);
        await settle();

        expect(repositoryRows).toEqual([]);
        expect(
            fixture.componentInstance.episodePlaybackPositions().size
        ).toBe(0);
    });

    it('reloads unrelated episode rows after a save invalidates a pending load', async () => {
        const { firstPosition, pendingLoad, secondPosition } =
            await startPendingTwoEpisodeLoad();
        const savedPosition = {
            ...firstPosition,
            positionSeconds: 70,
        };

        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: firstPosition.contentXtreamId,
            nextPosition: savedPosition,
        });
        await settle();
        pendingLoad.resolve([firstPosition, secondPosition]);
        await settle();

        expect(getSeriesPlaybackPositions).toHaveBeenCalledTimes(3);
        expect(
            fixture.componentInstance.episodePlaybackPositions()
        ).toEqual(
            new Map([
                [savedPosition.contentXtreamId, savedPosition],
                [secondPosition.contentXtreamId, secondPosition],
            ])
        );
    });

    it('reloads all episode rows after a mutation invalidates a pending load and rejects', async () => {
        const { firstPosition, pendingLoad, secondPosition } =
            await startPendingTwoEpisodeLoad();
        const saveError = new Error('save failed');
        savePlaybackPositionOrThrow.mockRejectedValue(saveError);

        const mutation =
            fixture.componentInstance.handlePlaybackToggleRequested({
                contentXtreamId: firstPosition.contentXtreamId,
                nextPosition: {
                    ...firstPosition,
                    positionSeconds: 70,
                },
            });
        await expect(mutation).rejects.toBe(saveError);
        await settle();
        pendingLoad.resolve([firstPosition, secondPosition]);
        await settle();

        expect(getSeriesPlaybackPositions).toHaveBeenCalledTimes(3);
        expect(
            fixture.componentInstance.episodePlaybackPositions()
        ).toEqual(
            new Map([
                [firstPosition.contentXtreamId, firstPosition],
                [secondPosition.contentXtreamId, secondPosition],
            ])
        );
    });

    it('migrates inline progress before cleanup and does not restore the legacy alias', async () => {
        repositoryRows = [
            createPosition({
                contentXtreamId: LEGACY_ID,
                positionSeconds: 25,
            }),
        ];
        await startWithLoadedEpisode();
        fixture.componentInstance.inlinePlayback.set({
            streamUrl: 'https://example.test/episode.mpg',
            title: 'Series 100 - Pilot',
            contentInfo: {
                playlistId: PLAYLIST_ID,
                contentXtreamId: SCOPED_A_ID,
                contentType: 'episode',
                seriesXtreamId: SERIES_A_ID,
                seasonNumber: 1,
                episodeNumber: 1,
            },
        });

        fixture.componentInstance.handleInlineTimeUpdate({
            currentTime: 60,
            duration: 100,
        });
        await settle();

        expect(repositoryOrder).toEqual([
            `save:${SCOPED_A_ID}`,
            `clear:${LEGACY_ID}`,
        ]);
        expect(repositoryRows.map((row) => row.contentXtreamId)).toEqual([
            SCOPED_A_ID,
        ]);

        const seasons = fixture.componentInstance.vodSeriesSeasons();
        fixture.componentInstance.vodSeriesSeasons.set(
            seasons.map((season) => ({
                ...season,
                episodes: [...season.episodes],
            }))
        );
        await settle();
        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: SCOPED_A_ID,
            nextPosition: createPosition({ positionSeconds: 70 }),
        });

        expect(
            repositoryOrder.filter(
                (entry) => entry === `clear:${LEGACY_ID}`
            )
        ).toHaveLength(1);
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)?.positionSeconds
        ).toBe(70);
        expect(getSeriesPlaybackPositions).toHaveBeenCalledTimes(1);
    });

    it('repeats a matching runtime save so the view can clear confirmed legacy progress', async () => {
        repositoryRows = [
            createPosition({
                contentXtreamId: LEGACY_ID,
                positionSeconds: 30,
            }),
        ];
        await startWithLoadedEpisode();
        const runtimePosition = createPosition({ positionSeconds: 65 });

        expect(runtimePositionListener).toBeDefined();
        runtimePositionListener?.(runtimePosition);
        await settle();

        expect(repositoryOrder).toEqual([
            `save:${SCOPED_A_ID}`,
            `clear:${LEGACY_ID}`,
        ]);
        expect(
            fixture.componentInstance
                .episodePlaybackPositions()
                .get(SCOPED_A_ID)
        ).toBe(runtimePosition);
    });

    it('clears confirmed legacy before scoped watched state without resurrection after refetch', async () => {
        const exactPosition = createPosition({
            positionSeconds: 100,
            durationSeconds: 100,
        });
        repositoryRows = [
            createPosition({
                contentXtreamId: LEGACY_ID,
                positionSeconds: 20,
            }),
            exactPosition,
        ];
        await startWithLoadedEpisode();

        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: SCOPED_A_ID,
            nextPosition: null,
        });
        await settle();

        expect(repositoryOrder).toEqual([
            `clear:${LEGACY_ID}`,
            `clear:${SCOPED_A_ID}`,
        ]);
        expect(repositoryRows).toEqual([]);
        expect(
            fixture.componentInstance.episodePlaybackPositions().size
        ).toBe(0);

        currentPlaylist.set(null);
        await settle();
        currentPlaylist.set({ _id: PLAYLIST_ID });
        await settle();

        expect(
            fixture.componentInstance.episodePlaybackPositions().size
        ).toBe(0);
        expect(getSeriesPlaybackPositions).toHaveBeenCalledTimes(2);
    });

    it('does not clear legacy state for regular-series episodes', async () => {
        selectedContentType.set('series');
        selectedItem.set(createRegularItem(SERIES_A_ID));
        serialSeasonsResource.set([
            {
                id: 'season-1',
                name: 'Season 1',
                cmd: '/media/file_100.mpg',
                series: [1],
            },
        ]);
        repositoryRows = [
            createPosition({
                contentXtreamId: REGULAR_ID,
                positionSeconds: 45,
            }),
        ];
        await settle();

        const watchedPosition = createPosition({
            contentXtreamId: REGULAR_ID,
            positionSeconds: 100,
        });
        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: REGULAR_ID,
            nextPosition: watchedPosition,
        });

        expect(savePlaybackPosition).toHaveBeenCalledWith(
            PLAYLIST_ID,
            watchedPosition
        );
        expect(clearPlaybackPosition).not.toHaveBeenCalled();
    });

    it('does not clear a coordinate-conflicting legacy row', async () => {
        const exactPosition = createPosition({ positionSeconds: 50 });
        repositoryRows = [
            exactPosition,
            createPosition({
                contentXtreamId: LEGACY_ID,
                seasonNumber: 9,
                positionSeconds: 25,
            }),
        ];
        await startWithLoadedEpisode();

        const watchedPosition = createPosition({ positionSeconds: 100 });
        await fixture.componentInstance.handlePlaybackToggleRequested({
            contentXtreamId: SCOPED_A_ID,
            nextPosition: watchedPosition,
        });

        expect(savePlaybackPosition).toHaveBeenCalledWith(
            PLAYLIST_ID,
            watchedPosition
        );
        expect(clearPlaybackPosition).not.toHaveBeenCalled();
    });

    async function startWithTwoLoadedEpisodes(): Promise<[number, number]> {
        await startWithLoadedEpisode();
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

    function expectSeasonToggleSnackbar(key: string): void {
        expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
            key,
            undefined,
            { duration: 5000 }
        );
    }

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
    });
});
