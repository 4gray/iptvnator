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
} from 'components';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import { of } from 'rxjs';
import { SerialDetailsComponent } from './serial-details.component';

@Component({
    selector: 'app-content-hero',
    standalone: true,
    template: '<ng-content />',
})
class StubContentHeroComponent {
    readonly title = input<string | undefined>(undefined);
    readonly description = input<string | undefined>(undefined);
    readonly posterUrl = input<string | undefined>(undefined);
    readonly backdropUrl = input<string | undefined>(undefined);
    readonly isLoading = input(false);
    readonly errorMessage = input<string | null>(null);
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
    readonly xtreamDownloadContext = input<unknown>(null);
    readonly openingEpisodeId = input<number | null>(null);
    readonly activeEpisodeId = input<number | null>(null);
    readonly episodeClicked = output<unknown>();
    readonly playbackToggleRequested = output<unknown>();
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
    });
    const fetchSerialDetailsWithMetadata = jest.fn();
    const checkFavoriteStatus = jest.fn();
    const constructEpisodeStreamUrl = jest.fn();
    const addRecentItem = jest.fn();
    const openResolvedPlayback = jest.fn();
    const getSeriesPlaybackPositions = jest.fn().mockResolvedValue([]);

    beforeEach(async () => {
        selectedItem.set({
            series_id: 103,
            info: {
                name: 'Series One',
                plot: 'Series plot',
                cover: 'cover.jpg',
                backdrop_path: [],
                genre: 'Drama',
            },
            episodes: {
                '1': [
                    {
                        id: '1001',
                        episode_num: 1,
                        title: 'Episode 1',
                        season: 1,
                    },
                ],
            },
        });
        isFavorite.set(false);
        isLoadingDetails.set(false);
        detailsError.set(null);
        fetchSerialDetailsWithMetadata.mockClear();
        checkFavoriteStatus.mockClear();
        constructEpisodeStreamUrl.mockReset();
        constructEpisodeStreamUrl.mockReturnValue(
            'http://xtream.example/series/1001.mp4'
        );
        addRecentItem.mockClear();
        openResolvedPlayback.mockClear();
        getSeriesPlaybackPositions.mockClear();
        getSeriesPlaybackPositions.mockResolvedValue([]);

        await TestBed.configureTestingModule({
            imports: [SerialDetailsComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
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
                        checkFavoriteStatus,
                        setSelectedItem: jest.fn((value: unknown) =>
                            selectedItem.set(value)
                        ),
                        toggleFavorite: jest.fn(),
                        constructEpisodeStreamUrl,
                        addRecentItem,
                        backfillContentBackdrop: jest.fn(),
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
                        ContentHeroComponent,
                        MatIcon,
                        PortalInlinePlayerComponent,
                        SeasonContainerComponent,
                        TranslatePipe,
                    ],
                },
                add: {
                    imports: [
                        StubContentHeroComponent,
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
            ],
        });
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
        expect(quickStartButton?.textContent).toContain(
            'S01E01 · Episode 1'
        );

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
        expect(quickStartButton?.textContent).toContain(
            'S01E01 · Episode 1'
        );

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
});
