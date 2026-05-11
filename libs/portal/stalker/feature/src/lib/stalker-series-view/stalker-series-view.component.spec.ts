import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { ContentHeroComponent, SeasonContainerComponent } from 'components';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    StalkerStore,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import { PlaybackPositionData } from 'shared-interfaces';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import { DownloadsService } from 'services';
import { of } from 'rxjs';
import { FavoritesButtonComponent } from '../stalker-favorites-button/stalker-favorites-button.component';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';

@Component({
    selector: 'app-content-hero',
    standalone: true,
    template: '<ng-content />',
})
class StubContentHeroComponent {
    readonly title = input<string | undefined>(undefined);
    readonly description = input<string | undefined>(undefined);
    readonly posterUrl = input<string | undefined>(undefined);
    readonly backClicked = output<void>();
}

@Component({
    selector: 'app-season-container',
    standalone: true,
    template: '<div data-testid="season-container"></div>',
})
class StubSeasonContainerComponent {
    readonly seasons = input<unknown>(null);
    readonly seriesId = input<number | string | null>(null);
    readonly playlistId = input('');
    readonly seriesTitle = input<string | undefined>(undefined);
    readonly playbackPositions = input<unknown>(null);
    readonly openingEpisodeId = input<number | null>(null);
    readonly activeEpisodeId = input<number | null>(null);
    readonly isLoading = input(false);
    readonly seasonSelected = output<string>();
    readonly episodeClicked = output<unknown>();
    readonly episodeDownloadRequested = output<unknown>();
    readonly playbackToggleRequested = output<unknown>();
    selectedSeason: string | undefined;
}

@Component({
    selector: 'app-portal-inline-player',
    standalone: true,
    template: '',
})
class StubPortalInlinePlayerComponent {
    readonly playback = input<unknown>(null);
    readonly timeUpdate = output<unknown>();
    readonly closed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<unknown>();
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
    const fetchVodSeriesEpisodes = jest.fn();
    const resolveVodPlayback = jest.fn();
    const getSeriesPlaybackPositions = jest.fn().mockResolvedValue([]);
    const openResolvedPlayback = jest.fn();

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
        fetchVodSeriesEpisodes.mockReset();
        resolveVodPlayback.mockReset();
        resolveVodPlayback.mockResolvedValue({
            streamUrl: 'http://stalker.example/episode.mpg',
            title: 'Regular Series',
            thumbnail: 'poster.jpg',
        });
        getSeriesPlaybackPositions.mockClear();
        getSeriesPlaybackPositions.mockResolvedValue([]);
        openResolvedPlayback.mockClear();

        await TestBed.configureTestingModule({
            imports: [StalkerSeriesViewComponent],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: {
                        selectedItem,
                        selectedContentType,
                        currentPlaylist: signal({ _id: 'stalker-1' }),
                        getSerialSeasonsResource: () => serialSeasonsResource(),
                        getVodSeriesSeasonsResource: () =>
                            vodSeriesSeasonsResource(),
                        isVodSeriesSeasonsLoading: signal(false),
                        isSerialSeasonsLoading: signal(false),
                        fetchVodSeriesEpisodes,
                        resolveVodPlayback,
                        fetchLinkToPlay: jest.fn(),
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
                        isEmbeddedPlayer: jest.fn().mockReturnValue(false),
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
                    provide: DownloadsService,
                    useValue: {
                        startDownload: jest.fn(),
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
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                    },
                },
            ],
        })
            .overrideComponent(StalkerSeriesViewComponent, {
                remove: {
                    imports: [
                        ContentHeroComponent,
                        FavoritesButtonComponent,
                        PortalInlinePlayerComponent,
                        SeasonContainerComponent,
                        TranslatePipe,
                    ],
                },
                add: {
                    imports: [
                        StubContentHeroComponent,
                        StubFavoritesButtonComponent,
                        StubPortalInlinePlayerComponent,
                        StubSeasonContainerComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
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
        fixture.detectChanges();
        await fixture.whenStable();
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

        fixture.detectChanges();
        await fixture.whenStable();
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

        fixture.detectChanges();
        await fixture.whenStable();

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

        fixture.detectChanges();
        await fixture.whenStable();

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
});
