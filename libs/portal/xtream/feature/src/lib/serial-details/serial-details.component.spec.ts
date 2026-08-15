import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Location } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import {
    ContentHeroComponent,
    SeasonContainerComponent,
} from '@iptvnator/ui/components';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    SeriesResumeTarget,
} from '@iptvnator/portal/shared/util';
import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import { SerialDetailsComponent } from './serial-details.component';
import { SerialDetailsPlaybackService } from './serial-details-playback.service';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details-resume-target.token';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

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
    readonly downloadAdapter = input<SeasonEpisodeDownloadAdapter | null>(null);
    readonly downloadsEnabled = input(true);
    readonly openingEpisodeId = input<number | null>(null);
    readonly activeEpisodeId = input<number | null>(null);
    readonly playingEpisodeId = input<number | null>(null);
    readonly seasonDescriptions = input<unknown>(null);
    readonly seasonWatchBatchRunning = input(false);
    readonly episodeClicked = output<unknown>();
    readonly playbackToggleRequested = output<unknown>();
    readonly seasonPlaybackToggleRequested = output<unknown>();
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
    selector: 'mat-icon',
    standalone: true,
    template: '<ng-content />',
})
class StubMatIconComponent {}

describe('SerialDetailsComponent', () => {
    let fixture: ComponentFixture<SerialDetailsComponent>;
    const selectedItem = signal<unknown>(null);
    const selectedContentType = signal<'series'>('series');
    const isFavorite = signal(false);
    const isLoadingDetails = signal(false);
    const detailsError = signal<string | null>(null);
    const currentPlaylist = signal({
        id: 'xtream-1',
        serverUrl: 'http://xtream.example',
        username: 'user',
        password: 'pass',
        userAgent: 'ProtectedProvider/2.0',
        referrer: 'https://referrer.example/series',
        origin: 'https://origin.example',
    });
    const fetchSerialDetailsWithMetadata = jest.fn();
    const cancelDetailsRequest = jest.fn();
    const checkFavoriteStatus = jest.fn();
    const constructEpisodeStreamUrl = jest.fn();
    const addRecentItem = jest.fn();
    const openResolvedPlayback = jest.fn();
    const openExternalPlayback = jest.fn();
    const savePlaybackPosition = jest.fn();
    const clearPlaybackPosition = jest.fn();
    const savePlaybackPositionsBatch = jest.fn();
    const clearPlaybackPositionsBatch = jest.fn();
    const loadAllPositions = jest.fn();
    const isEmbeddedPlayer = jest.fn();
    const getSeriesPlaybackPositions = jest.fn().mockResolvedValue([]);
    let positionUpdateCallback: ((data: PlaybackPositionData) => void) | null =
        null;
    let seriesResumeTarget: ReturnType<
        typeof signal<SeriesResumeTarget | null>
    >;
    let routeParams: BehaviorSubject<{
        categoryId: string;
        serialId: string;
    }>;

    beforeEach(async () => {
        window.history.replaceState({}, '', window.location.href);
        selectedItem.set({
            series_id: 103,
            info: {
                name: 'Series One',
                plot: 'Series plot',
                cover: 'cover.jpg',
                backdrop_path: [],
                genre: 'Drama',
                category_id: '3',
                tmdb_id: 901,
                tmdb_cast: [{ name: 'Sienna Wave', character: 'Mara' }],
            },
            episodes: {
                '1': [
                    {
                        id: '1001',
                        episode_num: 1,
                        title: 'Episode 1',
                        season: 1,
                    },
                    {
                        id: '1002',
                        episode_num: 2,
                        title: 'Episode 2',
                        season: 1,
                    },
                ],
                '2': [
                    {
                        id: '2001',
                        episode_num: 1,
                        title: 'Season 2 Episode 1',
                        season: 2,
                    },
                ],
            },
        });
        isFavorite.set(false);
        isLoadingDetails.set(false);
        detailsError.set(null);
        fetchSerialDetailsWithMetadata.mockClear();
        cancelDetailsRequest.mockClear();
        checkFavoriteStatus.mockClear();
        constructEpisodeStreamUrl.mockReset();
        constructEpisodeStreamUrl.mockImplementation(
            (episode: { id: string | number }) =>
                `http://xtream.example/series/${episode.id}.mp4`
        );
        addRecentItem.mockClear();
        openResolvedPlayback.mockReset();
        openResolvedPlayback.mockResolvedValue(undefined);
        openExternalPlayback.mockReset();
        openExternalPlayback.mockResolvedValue(undefined);
        savePlaybackPosition.mockReset();
        savePlaybackPosition.mockResolvedValue(undefined);
        clearPlaybackPosition.mockReset();
        clearPlaybackPosition.mockResolvedValue(undefined);
        savePlaybackPositionsBatch.mockReset();
        savePlaybackPositionsBatch.mockResolvedValue(undefined);
        clearPlaybackPositionsBatch.mockReset();
        clearPlaybackPositionsBatch.mockResolvedValue(undefined);
        loadAllPositions.mockReset();
        loadAllPositions.mockResolvedValue(undefined);
        positionUpdateCallback = null;
        isEmbeddedPlayer.mockReset();
        isEmbeddedPlayer.mockReturnValue(false);
        getSeriesPlaybackPositions.mockClear();
        getSeriesPlaybackPositions.mockResolvedValue([]);
        seriesResumeTarget = signal<SeriesResumeTarget | null>(null);
        routeParams = new BehaviorSubject({
            categoryId: '3',
            serialId: '103',
        });

        await TestBed.configureTestingModule({
            imports: [SerialDetailsComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        params: routeParams,
                        snapshot: {
                            params: {
                                categoryId: '3',
                                serialId: '103',
                            },
                        },
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        selectedItem,
                        selectedContentType,
                        isFavorite,
                        isLoadingDetails,
                        detailsError,
                        currentPlaylist,
                        fetchSerialDetailsWithMetadata,
                        cancelDetailsRequest,
                        checkFavoriteStatus,
                        setSelectedItem: jest.fn((value: unknown) =>
                            selectedItem.set(value)
                        ),
                        toggleFavorite: jest.fn(),
                        constructEpisodeStreamUrl,
                        addRecentItem,
                        backfillContentMetadata: jest.fn(),
                        loadAllPositions,
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
                        savePlaybackPosition,
                        clearPlaybackPosition,
                        savePlaybackPositionsBatch,
                        clearPlaybackPositionsBatch,
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer,
                        openResolvedPlayback,
                        openExternalPlayback,
                    },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: {
                        onPlaybackPositionUpdate: (
                            callback: (data: PlaybackPositionData) => void
                        ) => {
                            positionUpdateCallback = callback;
                            return () => {
                                positionUpdateCallback = null;
                            };
                        },
                    },
                },
                {
                    provide: XTREAM_SERIES_RESUME_TARGET,
                    useValue: seriesResumeTarget,
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
                {
                    provide: Location,
                    useValue: {
                        back: jest.fn(),
                    },
                },
            ],
        })
            .overrideComponent(SerialDetailsComponent, {
                remove: {
                    imports: [
                        MatIcon,
                        PortalInlinePlayerComponent,
                        SeasonContainerComponent,
                        TranslatePipe,
                    ],
                },
                add: {
                    imports: [
                        StubMatIconComponent,
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

        fixture = TestBed.createComponent(SerialDetailsComponent);
    });

    afterEach(() => {
        window.history.replaceState({}, '', window.location.href);
        fixture?.destroy();
    });

    it('initializes series metadata and renders the season container', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fetchSerialDetailsWithMetadata).toHaveBeenCalledWith({
            serialId: '103',
            categoryId: 3,
        });
        expect(checkFavoriteStatus).toHaveBeenCalledWith(
            103,
            'xtream-1',
            'series'
        );
        expect(getSeriesPlaybackPositions).toHaveBeenCalledWith(
            'xtream-1',
            103
        );

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        )?.componentInstance as StubSeasonContainerComponent | undefined;

        expect(seasonContainer).toBeDefined();
        expect(seasonContainer?.seriesId()).toBe(103);
        expect(seasonContainer?.playlistId()).toBe('xtream-1');
        expect(seasonContainer?.seasons()).toEqual({
            '1': [
                {
                    id: '1001',
                    episode_num: 1,
                    title: 'Episode 1',
                    season: 1,
                },
                {
                    id: '1002',
                    episode_num: 2,
                    title: 'Episode 2',
                    season: 1,
                },
            ],
            '2': [
                {
                    id: '2001',
                    episode_num: 1,
                    title: 'Season 2 Episode 1',
                    season: 2,
                },
            ],
        });
        expect(seasonContainer?.downloadsEnabled()).toBe(true);
        const adapter = seasonContainer?.downloadAdapter();
        const candidate = adapter?.createCandidate(
            (
                seasonContainer?.seasons() as Record<
                    string,
                    Array<Record<string, unknown>>
                >
            )['1'][0] as never,
            '1'
        );
        expect(candidate?.identity).toEqual({
            playlistId: 'xtream-1',
            contentType: 'episode',
            xtreamId: 1001,
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
        });
        await expect(candidate?.prepare()).resolves.toEqual({
            playlistId: 'xtream-1',
            xtreamId: 1001,
            contentType: 'episode',
            title: 'Series One - S01E01 - Episode 1',
            url: 'http://xtream.example/series/user/pass/1001.mp4',
            posterUrl: undefined,
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
            headers: {
                userAgent: 'ProtectedProvider/2.0',
                referer: 'https://referrer.example/series',
                origin: 'https://origin.example',
            },
            metadataSnapshot: {
                version: 1,
                language: 'en',
                mediaKind: 'series',
                title: 'Series One',
                plot: 'Series plot',
                genres: ['Drama'],
                tmdbId: 901,
                providerCategoryId: '3',
                cast: [{ name: 'Sienna Wave', role: 'Mara' }],
                episode: {
                    seasonNumber: 1,
                    episodeNumber: 1,
                    title: 'Episode 1',
                },
                enrichedAt: expect.any(String),
            },
        });
    });

    it('filters URL-only season overviews and falls back to TMDB descriptions', async () => {
        selectedItem.set({
            series_id: 103,
            info: {
                name: 'Series One',
                plot: 'Series plot',
                cover: 'cover.jpg',
                backdrop_path: [],
                genre: 'Drama',
                category_id: '3',
            },
            seasons: [
                {
                    season_number: 1,
                    overview:
                        'http://line.example.net:80/images/series/cover_small.jpg',
                },
                {
                    season_number: 2,
                    overview: 'Provider season 2 text',
                },
            ],
            tmdb_season_overviews: {
                '1': 'TMDB season 1 overview',
                '2': 'TMDB season 2 overview',
            },
            episodes: {
                '1': [
                    { id: '1001', episode_num: 1, title: 'E1', season: 1 },
                ],
                '2': [
                    { id: '2001', episode_num: 1, title: 'E1', season: 2 },
                ],
            },
        });

        fixture.detectChanges();
        await fixture.whenStable();

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        )?.componentInstance as StubSeasonContainerComponent;

        // The bare cover URL is junk → TMDB fills season 1; real provider
        // text keeps priority over TMDB for season 2.
        expect(seasonContainer.seasonDescriptions()).toEqual({
            '1': 'TMDB season 1 overview',
            '2': 'Provider season 2 text',
        });
    });

    it('keeps every provider episode but disables download presentation in provider-only mode', async () => {
        window.history.replaceState(
            { detailPresentation: 'provider-only' },
            '',
            window.location.href
        );

        fixture.detectChanges();
        await fixture.whenStable();

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        )?.componentInstance as StubSeasonContainerComponent;
        expect(fixture.componentInstance.providerOnly()).toBe(true);
        expect(seasonContainer.downloadsEnabled()).toBe(false);
        expect(
            Object.values(
                seasonContainer.seasons() as Record<string, unknown[]>
            ).flat()
        ).toHaveLength(3);
    });

    it('invalidates an in-flight detail request on teardown', () => {
        fixture.componentInstance.ngOnDestroy();

        expect(cancelDetailsRequest).toHaveBeenCalledTimes(1);
    });

    it('renders series metadata when backdrop_path is absent at runtime', () => {
        selectedItem.set({
            series_id: 103,
            info: {
                name: 'Series Without Backdrop',
                plot: 'Series plot',
                cover: 'cover.jpg',
                genre: 'Drama',
            },
            episodes: {},
        });

        expect(() => fixture.detectChanges()).not.toThrow();

        const hero = fixture.debugElement.query(
            By.directive(ContentHeroComponent)
        ).componentInstance as ContentHeroComponent;
        expect(hero.backdropUrl()).toBeUndefined();
    });

    it('renders quick start as the first episode action and opens that episode', async () => {
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

        expect(constructEpisodeStreamUrl).toHaveBeenCalledWith(
            expect.objectContaining({ id: '1001' })
        );
        expect(addRecentItem).toHaveBeenCalledWith({
            xtreamId: '103',
            contentType: 'series',
            playlist: currentPlaylist,
            backdropUrl: undefined,
        });
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/1001.mp4',
                title: 'Episode 1',
                startTime: undefined,
                contentInfo: expect.objectContaining({
                    contentXtreamId: 1001,
                    contentType: 'episode',
                    seriesXtreamId: 103,
                }),
            }),
            true
        );
    });

    it('resumes quick start from the stored episode position', async () => {
        getSeriesPlaybackPositions.mockResolvedValue([
            {
                contentXtreamId: 1001,
                contentType: 'episode',
                seriesXtreamId: 103,
                seasonNumber: 1,
                episodeNumber: 1,
                positionSeconds: 42,
                durationSeconds: 120,
                playlistId: 'xtream-1',
                updatedAt: '2026-05-10T12:00:00.000Z',
            },
        ]);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton?.textContent).toContain(
            'XTREAM.RESUME_EPISODE'
        );
        expect(quickStartButton?.textContent).toContain('S01E01 · Episode 1');

        quickStartButton?.click();

        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                startTime: 42,
                contentInfo: expect.objectContaining({
                    contentXtreamId: 1001,
                }),
            }),
            true
        );
    });

    it('records the selected episode after a successful external-player launch', async () => {
        openResolvedPlayback.mockResolvedValue({
            id: 'vlc-session-1',
            player: 'vlc',
            status: 'opened',
            title: 'Season 2 Episode 1',
            streamUrl: 'http://xtream.example/series/2001.mp4',
            startedAt: '2026-07-14T10:00:00.000Z',
            updatedAt: '2026-07-14T10:00:00.000Z',
            canClose: true,
        });
        fixture.detectChanges();
        await fixture.whenStable();

        fixture.componentInstance.playEpisode({
            id: '2001',
            episode_num: 1,
            title: 'Season 2 Episode 1',
            season: 2,
        } as never);
        await fixture.whenStable();

        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                playlistId: 'xtream-1',
                contentXtreamId: 2001,
                contentType: 'episode',
                seriesXtreamId: 103,
                seasonNumber: 2,
                episodeNumber: 1,
                positionSeconds: 0,
                updatedAt: expect.any(String),
            })
        );
        fixture.detectChanges();
        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );
        expect(quickStartButton?.textContent).toContain('XTREAM.PLAY_EPISODE');
        expect(quickStartButton?.textContent).toContain(
            'S02E01 \u00b7 Season 2 Episode 1'
        );
    });

    it('automatically resumes the exact dashboard episode after positions load', async () => {
        getSeriesPlaybackPositions.mockResolvedValue([
            {
                contentXtreamId: 2001,
                contentType: 'episode',
                seriesXtreamId: 103,
                seasonNumber: 2,
                episodeNumber: 1,
                positionSeconds: 84,
                durationSeconds: 1200,
                playlistId: 'xtream-1',
                updatedAt: '2026-05-10T12:00:00.000Z',
            },
        ]);
        seriesResumeTarget.set({
            seriesXtreamId: 103,
            contentXtreamId: 2001,
            seasonNumber: 2,
            episodeNumber: 1,
        });

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(constructEpisodeStreamUrl).toHaveBeenCalledTimes(1);
        expect(constructEpisodeStreamUrl).toHaveBeenCalledWith(
            expect.objectContaining({
                id: '2001',
                season: 2,
                episode_num: 1,
            })
        );
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/2001.mp4',
                startTime: 84,
                contentInfo: expect.objectContaining({
                    contentXtreamId: 2001,
                    seriesXtreamId: 103,
                    seasonNumber: 2,
                    episodeNumber: 1,
                }),
            }),
            true
        );
    });

    it('does not auto-resume the dashboard episode when positions fail to load', async () => {
        const warnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        getSeriesPlaybackPositions.mockRejectedValue(
            new Error('storage unavailable')
        );
        seriesResumeTarget.set({
            seriesXtreamId: 103,
            contentXtreamId: 2001,
            seasonNumber: 2,
            episodeNumber: 1,
        });

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(constructEpisodeStreamUrl).not.toHaveBeenCalled();
        expect(openResolvedPlayback).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('applies streamed playback-position updates for the selected series only', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        if (!positionUpdateCallback) {
            throw new Error('expected a playback-position subscription');
        }

        positionUpdateCallback({
            playlistId: 'other-playlist',
            contentXtreamId: 1001,
            contentType: 'episode',
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
            positionSeconds: 300,
            durationSeconds: 1200,
        } as PlaybackPositionData);
        fixture.detectChanges();

        const quickStartButton = (): HTMLButtonElement | null =>
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );
        expect(quickStartButton()?.textContent).not.toContain(
            'XTREAM.RESUME_EPISODE'
        );

        positionUpdateCallback({
            playlistId: 'xtream-1',
            contentXtreamId: 1001,
            contentType: 'episode',
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
            positionSeconds: 300,
            durationSeconds: 1200,
        } as PlaybackPositionData);
        fixture.detectChanges();

        expect(quickStartButton()?.textContent).toContain(
            'XTREAM.RESUME_EPISODE'
        );
        expect(quickStartButton()?.textContent).toContain('S01E01 · Episode 1');
    });

    it('persists the launched episode after an external fallback succeeds', async () => {
        openExternalPlayback.mockResolvedValue({
            id: 'mpv-session-1',
            player: 'mpv',
            status: 'opened',
        });
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        const trackLaunch = jest.fn();
        playbackService.handleExternalFallbackRequest({
            player: 'mpv',
            trackLaunch,
            playback: {
                streamUrl: 'http://xtream.example/series/2001.mp4',
                title: 'Season 2 Episode 1',
                contentInfo: {
                    playlistId: 'xtream-1',
                    contentXtreamId: 2001,
                    contentType: 'episode',
                    seriesXtreamId: 103,
                    seasonNumber: 2,
                    episodeNumber: 1,
                },
            },
            diagnostic: {},
        } as never);
        await fixture.whenStable();

        expect(openExternalPlayback).toHaveBeenCalledTimes(1);
        expect(trackLaunch).toHaveBeenCalledWith(
            openExternalPlayback.mock.results[0].value
        );
        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                contentXtreamId: 2001,
                contentType: 'episode',
                positionSeconds: 0,
            })
        );
    });

    it('persists throttled inline time updates for the playing episode', async () => {
        isEmbeddedPlayer.mockReturnValue(true);
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );

        // Without an inline playback there is nothing to persist.
        playbackService.handleInlineTimeUpdate({
            currentTime: 10,
            duration: 100,
        });
        expect(savePlaybackPosition).not.toHaveBeenCalled();

        fixture.componentInstance.playEpisode({
            id: '1001',
            episode_num: 1,
            title: 'Episode 1',
            season: 1,
        } as never);
        playbackService.handleInlineTimeUpdate({
            currentTime: 123.9,
            duration: 1200.4,
        });
        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                contentXtreamId: 1001,
                positionSeconds: 123,
                durationSeconds: 1200,
            })
        );

        // A second update inside the 15s throttle window is skipped.
        savePlaybackPosition.mockClear();
        playbackService.handleInlineTimeUpdate({
            currentTime: 130,
            duration: 1200,
        });
        expect(savePlaybackPosition).not.toHaveBeenCalled();
    });

    it('saves and clears positions for season-container toggle requests', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        await playbackService.handlePlaybackToggleRequested({
            contentXtreamId: 1001,
            nextPosition: {
                playlistId: 'xtream-1',
                contentXtreamId: 1001,
                contentType: 'episode',
                seriesXtreamId: 103,
                seasonNumber: 1,
                episodeNumber: 1,
                positionSeconds: 950,
                durationSeconds: 1000,
            },
        } as never);
        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({ contentXtreamId: 1001 })
        );

        await playbackService.handlePlaybackToggleRequested({
            contentXtreamId: 1001,
            nextPosition: null,
        } as never);
        expect(clearPlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            1001,
            'episode'
        );
    });

    it('marks a season watched through one batch save and updates rendered positions', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        const snackBar = TestBed.inject(MatSnackBar);
        const seasonPosition = (contentXtreamId: number, episodeNumber: number) => ({
            playlistId: 'xtream-1',
            contentXtreamId,
            contentType: 'episode' as const,
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber,
            positionSeconds: 1200,
            durationSeconds: 1200,
        });

        await playbackService.handleWatchToggleRequested(
            {
                seasonKey: '1',
                markWatched: true,
                requests: [
                    {
                        contentXtreamId: 1001,
                        nextPosition: seasonPosition(1001, 1),
                    },
                    {
                        contentXtreamId: 1002,
                        nextPosition: seasonPosition(1002, 2),
                    },
                ],
            } as never,
            'season'
        );

        expect(savePlaybackPositionsBatch).toHaveBeenCalledTimes(1);
        expect(savePlaybackPositionsBatch).toHaveBeenCalledWith('xtream-1', [
            expect.objectContaining({ contentXtreamId: 1001 }),
            expect.objectContaining({ contentXtreamId: 1002 }),
        ]);
        expect(savePlaybackPosition).not.toHaveBeenCalled();
        expect(
            playbackService.episodePlaybackPositions().get(1001)
        ).toEqual(expect.objectContaining({ positionSeconds: 1200 }));
        expect(
            playbackService.episodePlaybackPositions().get(1002)
        ).toBeDefined();
        expect(snackBar.open).toHaveBeenCalledWith(
            'XTREAM.SEASON_MARKED_WATCHED',
            undefined,
            { duration: 5000 }
        );
        // The catalog badge source must follow the batch.
        expect(loadAllPositions).toHaveBeenCalledWith('xtream-1');
        expect(playbackService.seasonWatchBatchRunning()).toBe(false);
    });

    it('unwatches a season through one batch clear', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        await playbackService.handleWatchToggleRequested(
            {
                seasonKey: '1',
                markWatched: false,
                requests: [
                    { contentXtreamId: 1001, nextPosition: null },
                    { contentXtreamId: 1002, nextPosition: null },
                ],
            } as never,
            'season'
        );

        expect(clearPlaybackPositionsBatch).toHaveBeenCalledTimes(1);
        expect(clearPlaybackPositionsBatch).toHaveBeenCalledWith('xtream-1', [
            { contentXtreamId: 1001, contentType: 'episode' },
            { contentXtreamId: 1002, contentType: 'episode' },
        ]);
        expect(clearPlaybackPosition).not.toHaveBeenCalled();
        expect(playbackService.episodePlaybackPositions().has(1001)).toBe(
            false
        );
    });

    it('does not write a stale season batch into another playlist state', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        let resolveBatch!: () => void;
        savePlaybackPositionsBatch.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveBatch = resolve;
                })
        );
        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        const pending = playbackService.handleWatchToggleRequested(
            {
                seasonKey: '1',
                markWatched: true,
                requests: [
                    {
                        contentXtreamId: 1001,
                        nextPosition: {
                            playlistId: 'xtream-1',
                            contentXtreamId: 1001,
                            contentType: 'episode',
                            seriesXtreamId: 103,
                            seasonNumber: 1,
                            episodeNumber: 1,
                            positionSeconds: 1200,
                            durationSeconds: 1200,
                        },
                    },
                ],
            } as never,
            'season'
        );

        // The user navigates to another playlist while the batch is pending.
        const initialPlaylist = currentPlaylist();
        currentPlaylist.set({ ...initialPlaylist, id: 'xtream-2' });
        resolveBatch();
        await pending;

        expect(savePlaybackPositionsBatch).toHaveBeenCalledWith(
            'xtream-1',
            expect.anything()
        );
        expect(playbackService.episodePlaybackPositions().has(1001)).toBe(
            false
        );
        expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
        // The store now belongs to the other playlist — no stale refresh.
        expect(loadAllPositions).not.toHaveBeenCalled();
        expect(playbackService.seasonWatchBatchRunning()).toBe(false);
        currentPlaylist.set(initialPlaylist);
    });

    it('keeps rendered positions and reports the error when the season batch fails', async () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        savePlaybackPositionsBatch.mockRejectedValue(
            new Error('batch failed')
        );
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        const snackBar = TestBed.inject(MatSnackBar);
        await playbackService.handleWatchToggleRequested(
            {
                seasonKey: '1',
                markWatched: true,
                requests: [
                    {
                        contentXtreamId: 1001,
                        nextPosition: {
                            playlistId: 'xtream-1',
                            contentXtreamId: 1001,
                            contentType: 'episode',
                            seriesXtreamId: 103,
                            seasonNumber: 1,
                            episodeNumber: 1,
                            positionSeconds: 1200,
                            durationSeconds: 1200,
                        },
                    },
                ],
            } as never,
            'season'
        );

        expect(playbackService.episodePlaybackPositions().has(1001)).toBe(
            false
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'XTREAM.SEASON_WATCH_UPDATE_FAILED',
            undefined,
            { duration: 5000 }
        );
        expect(playbackService.seasonWatchBatchRunning()).toBe(false);
        consoleError.mockRestore();
    });

    it('passes inline episode metadata and autoplays only inside the current season', async () => {
        isEmbeddedPlayer.mockReturnValue(true);
        fixture.detectChanges();
        await fixture.whenStable();

        const episodes = (fixture.componentInstance.selectedItem()?.episodes ??
            {}) as Record<string, Array<{ id: string; title: string }>>;
        fixture.componentInstance.playEpisode(episodes['1'][0] as never);
        fixture.detectChanges();

        let inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        expect(inlinePlayer.episodeMetadata()).toEqual({
            label: 'S01E01',
            title: 'Episode 1',
            seasonNumber: 1,
            episodeNumber: 1,
        });
        const firstEpisodeKey = createPlaybackSessionKey({
            kind: 'episode',
            sourceId: 'xtream-1',
            contentId: 1001,
            seriesId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
        });
        expect(inlinePlayer.playbackSessionKey()).toBe(firstEpisodeKey);
        expect(inlinePlayer.seriesNavigation()).toEqual({
            canPrevious: false,
            canNext: true,
            autoplayEnabled: true,
        });

        inlinePlayer.playbackEnded.emit();
        fixture.detectChanges();

        inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        expect(inlinePlayer.playback()).toEqual(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/1002.mp4',
                title: 'Episode 2',
                contentInfo: expect.objectContaining({
                    contentXtreamId: 1002,
                    seasonNumber: 1,
                    episodeNumber: 2,
                }),
            })
        );
        expect(inlinePlayer.seriesNavigation()).toEqual({
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        expect(inlinePlayer.playbackSessionKey()).not.toBe(firstEpisodeKey);

        inlinePlayer.playbackEnded.emit();
        fixture.detectChanges();

        expect(inlinePlayer.playback()).toEqual(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/1002.mp4',
            })
        );
        expect(constructEpisodeStreamUrl).not.toHaveBeenCalledWith(
            expect.objectContaining({ id: '2001' })
        );
    });

    it('owns the parent identity from the route and ignores replacement playback payloads', async () => {
        isEmbeddedPlayer.mockReturnValue(true);
        fixture.detectChanges();
        await fixture.whenStable();
        const item = fixture.componentInstance.selectedItem();
        const episode = item?.episodes?.['1'][0];
        if (!item || !episode) {
            throw new Error('Expected the serial fixture and first episode');
        }
        fixture.componentInstance.playEpisode(episode);
        fixture.detectChanges();
        const expected = createPlaybackSessionKey({
            kind: 'episode',
            sourceId: 'xtream-1',
            contentId: 1001,
            seriesId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
        });
        expect(fixture.componentInstance.playbackSessionKey()).toBe(expected);

        fixture.componentInstance.inlinePlayback.set({
            streamUrl: 'https://alternative.example/replaced.mkv',
            title: 'Alternative payload',
            headers: { Authorization: 'Bearer replacement' },
            contentInfo: {
                playlistId: 'alternative-playlist',
                contentXtreamId: 999001,
                contentType: 'episode',
                seriesXtreamId: 999,
                seasonNumber: 9,
                episodeNumber: 9,
            },
        });
        expect(fixture.componentInstance.playbackSessionKey()).toBe(expected);

        selectedItem.set({ ...item, series_id: 999 });
        routeParams.next({ categoryId: '3', serialId: '104' });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.componentInstance.playEpisode(episode);
        fixture.detectChanges();

        expect(fixture.componentInstance.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'episode',
                sourceId: 'xtream-1',
                contentId: 1001,
                seriesId: 104,
                seasonNumber: 1,
                episodeNumber: 1,
            })
        );
    });
});
