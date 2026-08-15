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
});
