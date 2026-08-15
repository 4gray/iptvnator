import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { SeasonContainerComponent } from '@iptvnator/ui/components';
import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    StalkerStore,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { EMPTY, of } from 'rxjs';
import { FavoritesButtonComponent } from '../stalker-favorites-button/stalker-favorites-button.component';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';

@Component({
    selector: 'app-season-container',
    template: '<div data-testid="season-container"></div>',
})
class StubSeasonContainerComponent {
    readonly seasons = input<unknown>(null);
    readonly hasUnloadedSeasons = input(false);
    readonly seriesId = input<number | string | null>(null);
    readonly playlistId = input('');
    readonly seriesTitle = input<string | undefined>(undefined);
    readonly playbackPositions = input<unknown>(null);
    readonly openingEpisodeId = input<number | null>(null);
    readonly activeEpisodeId = input<number | null>(null);
    readonly playingEpisodeId = input<number | null>(null);
    readonly seasonDescriptions = input<unknown>(null);
    readonly isLoading = input(false);
    readonly downloadsEnabled = input(true);
    readonly downloadAdapter = input<SeasonEpisodeDownloadAdapter | null>(null);
    readonly seasonWatchBatchRunning = input(false);
    readonly seasonSelected = output<string>();
    readonly episodeClicked = output<unknown>();
    readonly playbackToggleRequested = output<unknown>();
    readonly seasonPlaybackToggleRequested = output<unknown>();
    readonly selectedSeason = signal<string | undefined>(undefined);
}

@Component({
    selector: 'app-portal-inline-player',
    standalone: true,
    template: '',
})
class StubPortalInlinePlayerComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly playback = input<unknown>(null);
    readonly episodeMetadata = input<unknown>(null);
    readonly seriesTitle = input<string | null>(null);
    readonly seriesNavigation = input<unknown>(null);
    readonly upNextEpisodes = input<unknown>(null);
    readonly timeUpdate = output<unknown>();
    readonly closed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly upNextEpisodeSelected = output<unknown>();
}

@Component({
    selector: 'app-favorites-button',
    standalone: true,
    template: '<button class="favorite-btn">favorite</button>',
})
class StubFavoritesButtonComponent {
    readonly itemId = input<string | number | undefined>(undefined);
    readonly item = input<unknown>(null);
}

describe('StalkerSeriesViewComponent', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    const selectedContentType = signal<'series' | 'vod'>('series');
    const selectedItem = signal<StalkerVodSource | null>(null);
    const serialSeasonsResource = signal<unknown[]>([]);
    const vodSeriesSeasonsResource = signal<unknown[]>([]);
    const isSerialSeasonsLoading = signal(false);
    const fetchVodSeriesEpisodes = jest.fn();
    const resolveVodPlayback = jest.fn();
    const getSeriesPlaybackPositions = jest.fn().mockResolvedValue([]);
    const openResolvedPlayback = jest.fn();
    const isEmbeddedPlayer = jest.fn();
    const tmdbGetSeason = jest.fn();
    const fetchLinkToPlay = jest.fn();
    const currentPlaylist = signal({
        _id: 'stalker-1',
        title: 'Living Room Portal',
        portalUrl: 'https://stalker.example.test',
        macAddress: '00:1A:79:12:34:56',
    });

    async function stabilize(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
    }

    beforeEach(async () => {
        selectedContentType.set('series');
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series',
                description: 'Series description',
                movie_image: 'poster.jpg',
            },
        });
        serialSeasonsResource.set([
            {
                id: 'season-1',
                name: 'Season 1',
                cmd: '/media/file_30001.mpg',
                series: [1, 2],
            },
        ]);
        vodSeriesSeasonsResource.set([]);
        isSerialSeasonsLoading.set(false);
        fetchVodSeriesEpisodes.mockReset();
        resolveVodPlayback.mockReset();
        resolveVodPlayback.mockImplementation(
            async (
                _cmd?: string,
                title?: string,
                thumbnail?: string,
                _episodeNum?: number,
                episodeId?: number,
                startTime?: number
            ) => ({
                streamUrl: 'http://stalker.example/episode.mpg',
                title: title ?? 'Regular Series',
                thumbnail: thumbnail ?? 'poster.jpg',
                startTime,
                contentInfo: {
                    playlistId: 'stalker-1',
                    contentXtreamId:
                        episodeId ?? Number(selectedItem()?.id ?? 0),
                    contentType: episodeId ? 'episode' : 'vod',
                    seriesXtreamId: episodeId
                        ? Number(selectedItem()?.id ?? 0)
                        : undefined,
                },
            })
        );
        getSeriesPlaybackPositions.mockClear();
        getSeriesPlaybackPositions.mockResolvedValue([]);
        openResolvedPlayback.mockClear();
        isEmbeddedPlayer.mockReset();
        isEmbeddedPlayer.mockReturnValue(false);
        tmdbGetSeason.mockReset();
        tmdbGetSeason.mockResolvedValue({
            overview: 'Season overview from TMDB',
            episodes: [],
        });
        fetchLinkToPlay
            .mockReset()
            .mockResolvedValue('https://cdn.example.test/episode.mpg');
        currentPlaylist.set({
            _id: 'stalker-1',
            title: 'Living Room Portal',
            portalUrl: 'https://stalker.example.test',
            macAddress: '00:1A:79:12:34:56',
        });

        await TestBed.configureTestingModule({
            imports: [StalkerSeriesViewComponent],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: {
                        selectedItem,
                        selectedContentType,
                        currentPlaylist,
                        getSerialSeasonsResource: () => serialSeasonsResource(),
                        getVodSeriesSeasonsResource: () =>
                            vodSeriesSeasonsResource(),
                        isVodSeriesSeasonsLoading: signal(false),
                        isSerialSeasonsLoading,
                        fetchVodSeriesEpisodes,
                        resolveVodPlayback,
                        fetchLinkToPlay,
                        clearSelectedItem: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal(null),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getSeriesPlaybackPositions,
                        savePlaybackPosition: jest.fn(),
                        clearPlaybackPosition: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer,
                        openResolvedPlayback,
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        navigateByUrl: jest.fn(),
                    },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => true,
                        getSeason: tmdbGetSeason,
                        getSeasonEpisodes: jest.fn().mockResolvedValue(null),
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
                        currentLang: 'en',
                        defaultLang: 'en',
                        // EMPTY (not of(null)): the real TranslatePipe inside
                        // the detail shell reads `event.lang` from emissions.
                        onLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                        onDefaultLangChange: EMPTY,
                    },
                },
            ],
        })
            .overrideComponent(StalkerSeriesViewComponent, {
                remove: {
                    imports: [
                        FavoritesButtonComponent,
                        PortalInlinePlayerComponent,
                        SeasonContainerComponent,
                        TranslatePipe,
                    ],
                },
                add: {
                    imports: [
                        StubFavoritesButtonComponent,
                        StubPortalInlinePlayerComponent,
                        StubSeasonContainerComponent,
                        MockPipe(
                            TranslatePipe,
                            (
                                value: string | null | undefined,
                                params?: Record<string, number>
                            ) => {
                                if (value === 'XTREAM.PLAY_EPISODE') {
                                    return `Play episode ${
                                        params?.['episode'] ?? '{{episode}}'
                                    }`;
                                }
                                return value ?? '';
                            }
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(StalkerSeriesViewComponent);
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('renders quick start for regular series and starts the first episode', async () => {
        await stabilize();
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.textContent).toContain(
            'XTREAM.PLAY_FIRST_EPISODE'
        );
        expect(quickStartButton?.textContent).toContain('S01E01 · Episode 1');

        quickStartButton?.click();
        await fixture.whenStable();

        expect(resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_30001.mpg',
            'Regular Series',
            'poster.jpg',
            1,
            expect.any(Number),
            undefined
        );
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'http://stalker.example/episode.mpg',
            }),
            true
        );
    });

    it('keeps provider episodes playable while hiding download presentation', async () => {
        fixture.componentRef.setInput('providerOnly', true);

        await stabilize();

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        ).componentInstance as StubSeasonContainerComponent;
        expect(seasonContainer.downloadsEnabled()).toBe(false);
        expect(
            Object.values(
                seasonContainer.seasons() as Record<string, unknown[]>
            ).flat()
        ).toHaveLength(2);
        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            )
        ).not.toBeNull();
    });

    it('binds a Stalker adapter that prepares canonical episode metadata', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            category_id: '18',
            info: { name: 'Signal House' },
        });

        await stabilize();

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        ).componentInstance as StubSeasonContainerComponent;
        const initialAdapter = seasonContainer.downloadAdapter();
        const candidate = initialAdapter?.createCandidate(
            {
                id: '61001',
                episode_num: 3,
                title: 'The Call',
                custom_sid: 'vod-series',
                season: 2,
                originalId: '502',
            } as never,
            '2'
        );

        const request = await candidate?.prepare();

        expect(fetchLinkToPlay).toHaveBeenCalledWith(
            'https://stalker.example.test',
            '00:1A:79:12:34:56',
            '/media/file_502.mpg',
            3
        );
        expect(request).toEqual(
            expect.objectContaining({
                episodeIdentityScope: 'stalker-lazy-vod',
                playlistId: 'stalker-1',
                seriesXtreamId: 50001,
                xtreamId: 61001,
                title: 'Signal House - S02E03 - The Call',
            })
        );

        currentPlaylist.set({
            _id: 'stalker-2',
            title: 'Bedroom Portal',
            portalUrl: 'https://bedroom.example.test',
            macAddress: '00:1A:79:65:43:21',
        });
        selectedItem.set({
            id: '40002:season-slice',
            category_id: '22',
            info: { name: 'Second Signal' },
        });
        await stabilize();

        const updatedAdapter = seasonContainer.downloadAdapter();
        expect(updatedAdapter).not.toBe(initialAdapter);
        const updatedCandidate = updatedAdapter?.createCandidate(
            {
                id: '62001',
                episode_num: 1,
                title: 'Pilot',
                custom_sid: 'regular-series',
                season: 4,
                originalCmd: '/media/file_888.mpg',
            } as never,
            '4'
        );
        if (!updatedCandidate) {
            throw new Error('expected a refreshed Stalker download adapter');
        }
        const updatedRequest = await updatedCandidate.prepare();

        expect(fetchLinkToPlay).toHaveBeenLastCalledWith(
            'https://bedroom.example.test',
            '00:1A:79:65:43:21',
            '/media/file_888.mpg',
            1
        );
        expect(updatedRequest).toEqual(
            expect.objectContaining({
                episodeIdentityScope: 'stalker-regular-series',
                playlistId: 'stalker-2',
                seriesXtreamId: 40002,
                xtreamId: 62001,
                title: 'Second Signal - S04E01 - Pilot',
                portalUrl: 'https://bedroom.example.test',
                macAddress: '00:1A:79:65:43:21',
                metadataSnapshot: expect.objectContaining({
                    title: 'Second Signal',
                    providerCategoryId: '22',
                }),
            })
        );
    });

    it('interpolates the episode number for a recently started VOD is_series episode', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: '1',
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([]);

        await stabilize();
        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    {
                        id: 'episode-1',
                        series_number: 1,
                        name: 'Pilot',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        const episode = fixture.componentInstance.mappedSeasons()['1'][0];
        fixture.componentInstance.episodePlaybackPositions.set(
            new Map([
                [
                    Number(episode.id),
                    {
                        contentXtreamId: Number(episode.id),
                        contentType: 'episode',
                        seriesXtreamId: 50001,
                        positionSeconds: 5,
                        durationSeconds: 100,
                    },
                ],
            ])
        );
        fixture.detectChanges();

        const button: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(
            fixture.componentInstance.quickStartAction()?.labelParams
        ).toEqual({ episode: 1 });
        expect(button?.textContent).toContain('Play episode 1');
        expect(button?.textContent).not.toContain('{{episode}}');
    });

    it('loads the first VOD-series season and starts its first episode from quick start', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
        ]);
        fetchVodSeriesEpisodes.mockResolvedValue([
            {
                id: 'episode-10',
                series_number: 10,
                name: 'Finale',
            },
            {
                id: 'episode-1',
                series_number: 1,
                name: 'Pilot',
            },
        ]);

        await stabilize();
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.textContent).toContain('S01E01');

        quickStartButton?.click();
        await fixture.whenStable();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledWith(
            '50001',
            'season-1'
        );
        expect(resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_episode-1.mpg',
            'VOD Flagged Series - Pilot',
            'vod-series.jpg',
            1,
            expect.any(Number),
            undefined
        );
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                contentInfo: expect.objectContaining({
                    seasonNumber: 1,
                    episodeNumber: 1,
                }),
            }),
            true
        );
    });

    it('loads an earlier unloaded VOD-series season before showing completed', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
        ]);
        fetchVodSeriesEpisodes.mockResolvedValue([
            {
                id: 'episode-1',
                series_number: 1,
                name: 'Pilot',
            },
        ]);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [
                    {
                        id: 'episode-2',
                        series_number: 1,
                        name: 'Second Season Pilot',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        const watchedEpisode =
            fixture.componentInstance.mappedSeasons()['2'][0];
        const watchedPosition: PlaybackPositionData = {
            contentXtreamId: Number(watchedEpisode.id),
            contentType: 'episode',
            seriesXtreamId: 50001,
            positionSeconds: 95,
            durationSeconds: 100,
        };
        fixture.componentInstance.episodePlaybackPositions.set(
            new Map([[Number(watchedEpisode.id), watchedPosition]])
        );
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.disabled).toBe(false);
        expect(quickStartButton?.textContent).toContain(
            'XTREAM.PLAY_NEXT_EPISODE'
        );
        expect(quickStartButton?.textContent).toContain('S01E01');

        quickStartButton?.click();
        await fixture.whenStable();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledWith(
            '50001',
            'season-1'
        );
        expect(resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_episode-1.mpg',
            'VOD Flagged Series - Pilot',
            'vod-series.jpg',
            1,
            expect.any(Number),
            undefined
        );
    });

    it('passes inline episode metadata and autoplays only loaded current-season episodes for VOD is_series playback', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
        ]);
        isEmbeddedPlayer.mockReturnValue(true);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    {
                        id: 'episode-1',
                        series_number: 1,
                        name: 'Pilot',
                    },
                    {
                        id: 'episode-2',
                        series_number: 2,
                        name: 'Second',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [
                    {
                        id: 'episode-3',
                        series_number: 1,
                        name: 'Next Season',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        fetchVodSeriesEpisodes.mockClear();

        const seasonOneEpisodes =
            fixture.componentInstance.mappedSeasons()['1'];
        const firstEpisode = seasonOneEpisodes[0];
        const secondEpisode = seasonOneEpisodes[1];
        const seasonTwoEpisode =
            fixture.componentInstance.mappedSeasons()['2'][0];

        fixture.componentInstance.onEpisodeClicked(firstEpisode);
        await fixture.whenStable();
        fixture.detectChanges();

        const inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;

        expect(inlinePlayer.playback()).toEqual(
            expect.objectContaining({
                contentInfo: expect.objectContaining({
                    seasonNumber: 1,
                    episodeNumber: 1,
                }),
            })
        );
        // Prettier expands these compact fixtures enough to breach the spec's
        // hard 1,200-line lint limit.
        // prettier-ignore
        expect(inlinePlayer.episodeMetadata()).toEqual({ label: 'S01E01', title: 'Pilot', seasonNumber: 1, episodeNumber: 1 });
        expect(inlinePlayer.seriesNavigation()).toEqual({
            canPrevious: false,
            canNext: true,
            autoplayEnabled: true,
        });
        const firstEpisodeKey = inlinePlayer.playbackSessionKey();
        expect(firstEpisodeKey).not.toBe('');

        inlinePlayer.playbackEnded.emit();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(resolveVodPlayback).toHaveBeenLastCalledWith(
            '/media/file_episode-2.mpg',
            'VOD Flagged Series - Second',
            'vod-series.jpg',
            2,
            Number(secondEpisode.id),
            undefined
        );
        expect(inlinePlayer.episodeMetadata()).toEqual({
            label: 'S01E02',
            title: 'Second',
            seasonNumber: 1,
            episodeNumber: 2,
        });
        expect(inlinePlayer.seriesNavigation()).toEqual({
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        expect(inlinePlayer.playbackSessionKey()).not.toBe(firstEpisodeKey);

        inlinePlayer.playbackEnded.emit();
        await fixture.whenStable();

        expect(fetchVodSeriesEpisodes).not.toHaveBeenCalled();
        expect(resolveVodPlayback).not.toHaveBeenCalledWith(
            '/media/file_episode-3.mpg',
            'VOD Flagged Series - Next Season',
            'vod-series.jpg',
            1,
            Number(seasonTwoEpisode.id),
            undefined
        );
    });

    it('prefetches the next unopened season so the Up Next rail can spill over', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
        ]);
        isEmbeddedPlayer.mockReturnValue(true);

        await stabilize();

        // Season 1 loaded, season 2 still empty — the state a user is in
        // right after opening the series and starting the first episode.
        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    { id: 'episode-1', series_number: 1, name: 'Pilot' },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        fetchVodSeriesEpisodes.mockClear();
        fetchVodSeriesEpisodes.mockResolvedValue([
            { id: 'episode-3', series_number: 1, name: 'Next Season' },
        ]);

        const firstEpisode = fixture.componentInstance.mappedSeasons()['1'][0];
        fixture.componentInstance.onEpisodeClicked(firstEpisode);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledWith(
            '50001',
            'season-2'
        );

        const inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        const railItems = inlinePlayer.upNextEpisodes() as Array<{
            label: string;
        }>;
        expect(railItems.map((item) => item.label)).toEqual([
            'S01E01',
            'S02E01',
        ]);
    });

    it('does not re-request a spillover season that came back empty', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
        ]);
        isEmbeddedPlayer.mockReturnValue(true);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    { id: 'episode-1', series_number: 1, name: 'Pilot' },
                    { id: 'episode-2', series_number: 2, name: 'Second' },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        fetchVodSeriesEpisodes.mockClear();
        // Failed or genuinely empty season: isLoading returns to false while
        // episodes stays empty — the retry trap.
        fetchVodSeriesEpisodes.mockResolvedValue([]);

        const seasonOne = fixture.componentInstance.mappedSeasons()['1'];
        fixture.componentInstance.onEpisodeClicked(seasonOne[0]);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(1);

        // Further playback activity in the same season must not retrigger it.
        fixture.componentInstance.onEpisodeClicked(seasonOne[1]);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(1);
    });

    it('retries a failed spillover prefetch on the next episode', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
        ]);
        isEmbeddedPlayer.mockReturnValue(true);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    { id: 'episode-1', series_number: 1, name: 'Pilot' },
                    { id: 'episode-2', series_number: 2, name: 'Second' },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        fetchVodSeriesEpisodes.mockClear();
        fetchVodSeriesEpisodes.mockRejectedValueOnce(new Error('network'));

        const seasonOne = fixture.componentInstance.mappedSeasons()['1'];
        fixture.componentInstance.onEpisodeClicked(seasonOne[0]);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        // The failure must not loop while the same episode keeps playing.
        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(1);

        // Moving to the next episode gives the transient failure a new chance.
        fetchVodSeriesEpisodes.mockResolvedValue([
            { id: 'episode-3', series_number: 1, name: 'Next Season' },
        ]);
        fixture.componentInstance.onEpisodeClicked(seasonOne[1]);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(2);

        const inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        const railItems = inlinePlayer.upNextEpisodes() as Array<{
            label: string;
        }>;
        expect(railItems.map((item) => item.label)).toEqual([
            'S01E02',
            'S02E01',
        ]);
    });

    it('loads the next unloaded VOD-series season after the loaded season is watched', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
        ]);
        fetchVodSeriesEpisodes.mockResolvedValue([
            {
                id: 'episode-2',
                series_number: 1,
                name: 'Second Season Pilot',
            },
        ]);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    {
                        id: 'episode-1',
                        series_number: 1,
                        name: 'Pilot',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        const watchedEpisode =
            fixture.componentInstance.mappedSeasons()['1'][0];
        const watchedPosition: PlaybackPositionData = {
            contentXtreamId: Number(watchedEpisode.id),
            contentType: 'episode',
            seriesXtreamId: 50001,
            positionSeconds: 95,
            durationSeconds: 100,
        };
        fixture.componentInstance.episodePlaybackPositions.set(
            new Map([[Number(watchedEpisode.id), watchedPosition]])
        );
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.textContent).toContain(
            'XTREAM.PLAY_NEXT_EPISODE'
        );
        expect(quickStartButton?.textContent).toContain('S02E01');

        quickStartButton?.click();
        await fixture.whenStable();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledWith(
            '50001',
            'season-2'
        );
        expect(resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_episode-2.mpg',
            'VOD Flagged Series - Second Season Pilot',
            'vod-series.jpg',
            1,
            expect.any(Number),
            undefined
        );
    });

    it('fetches the TMDB season once the show-level match arrives after auto-select', async () => {
        await stabilize();
        fixture.detectChanges();

        // Season tabs auto-select immediately — usually before the async
        // show-level enrichment has written tmdb_id.
        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        ).componentInstance as StubSeasonContainerComponent;
        seasonContainer.seasonSelected.emit('1');
        await stabilize();
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        // The TMDB match lands afterwards — the fetch must run now.
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series',
                description: 'Series description',
                movie_image: 'poster.jpg',
                tmdb_id: 777,
            },
        } as never);
        await stabilize();

        expect(tmdbGetSeason).toHaveBeenCalledWith(777, 1);
    });

    it('waits for the season map before fetching so a per-season slice gets the title-marked season', async () => {
        serialSeasonsResource.set([]);
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series (2 season)',
                description: 'Series description',
                movie_image: 'poster.jpg',
                tmdb_id: 777,
            },
        } as never);
        await stabilize();

        fixture.componentInstance.onSeasonSelected('1');
        await stabilize();

        // Season resource still loading — fetching now would pass a zero
        // season count, suppress the title-marker override and cache the
        // wrong season forever (fetchSeason is idempotent).
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        serialSeasonsResource.set([
            {
                id: 'season-1',
                name: 'Season 1',
                cmd: '/media/file_30001.mpg',
                series: [1, 2],
            },
        ]);
        await stabilize();

        // Single-season slice whose provider season is renumbered to 1:
        // the title marker names the real TMDB season.
        expect(tmdbGetSeason).toHaveBeenCalledWith(777, 2);
    });

    it('gates the fetch on the reloading season resource during detail-to-detail navigation', async () => {
        await stabilize();

        fixture.componentInstance.onSeasonSelected('1');
        await stabilize();
        // No show-level TMDB match yet — nothing fetched for the first item
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        // Detail-to-detail navigation reuses the component; the new item's
        // TMDB match can arrive while the season resource reloads and the
        // map still shows the previous series' seasons.
        isSerialSeasonsLoading.set(true);
        selectedItem.set({
            id: '30002',
            cmd: '/media/file_30002.mpg',
            info: {
                name: 'Other Series (2 season)',
                description: 'Other description',
                movie_image: 'poster2.jpg',
                tmdb_id: 888,
            },
        } as never);
        await stabilize();

        // The new tmdb_id must NOT pair with the previous series' season
        // context while the resource reloads.
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        // Once the new item's own seasons land, the fetch runs WITHOUT a
        // new seasonSelected emission — the season container deduplicates
        // emissions when both items share the same season-key set, so the
        // retained key must stay usable.
        serialSeasonsResource.set([
            {
                id: 'season-1',
                name: 'Season 1',
                cmd: '/media/file_30002.mpg',
                series: [1, 2],
            },
        ]);
        isSerialSeasonsLoading.set(false);
        await stabilize();
        expect(tmdbGetSeason).toHaveBeenCalledWith(888, 2);
    });

    it('enriches after equal-id navigation once the season resource settles', async () => {
        await stabilize();
        fixture.componentInstance.onSeasonSelected('1');
        await stabilize();

        // Distinct items can reuse a provider id; the loading gate (not an
        // id comparison) keeps the stale map from being used.
        isSerialSeasonsLoading.set(true);
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Different Series (3 season)',
                description: 'Different description',
                movie_image: 'poster3.jpg',
                tmdb_id: 999,
            },
        } as never);
        await stabilize();
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        isSerialSeasonsLoading.set(false);
        await stabilize();
        expect(tmdbGetSeason).toHaveBeenCalledWith(999, 3);
    });

    it('reads the season marker from o_name when name is generic', async () => {
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series',
                o_name: 'Regular Series (2 season)',
                description: 'Series description',
                movie_image: 'poster.jpg',
                tmdb_id: 777,
            },
        } as never);
        await stabilize();

        fixture.componentInstance.onSeasonSelected('1');
        await stabilize();

        expect(tmdbGetSeason).toHaveBeenCalledWith(777, 2);
    });
});
