import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
import { of } from 'rxjs';
import { EPISODE_INFO_PLAY } from './episode-info-dialog.component';
import { SeasonContainerComponent } from './season-container.component';

const downloadsServiceStub = {
    isAvailable: signal(false),
    downloads: () => [],
    startDownload: async () => undefined,
    isDownloaded: () => false,
    isDownloading: () => false,
    getDownloadedFilePath: () => '',
    playDownload: async () => undefined,
};

function createEpisode(
    overrides: Partial<XtreamSerieEpisode> = {}
): XtreamSerieEpisode {
    return {
        id: '101',
        episode_num: 1,
        title: 'Pilot',
        container_extension: 'mp4',
        info: {
            duration: '45 min',
            plot: 'Pilot episode',
            movie_image: 'https://example.com/poster.jpg',
        },
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
        ...overrides,
    };
}

const dialogOpen = jest.fn();

describe('SeasonContainerComponent', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;
    let emittedSeasons: string[];

    const setRequiredInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>,
        isLoading = false
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 1);
        fixture.componentRef.setInput('playlistId', 'playlist-1');
        fixture.componentRef.setInput('isLoading', isLoading);
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                NoopAnimationsModule,
                SeasonContainerComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: DownloadsService,
                    useValue: downloadsServiceStub,
                },
                {
                    provide: MatDialog,
                    useValue: { open: dialogOpen },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SeasonContainerComponent);
        component = fixture.componentInstance;
        emittedSeasons = [];
        dialogOpen.mockReset();
        dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });
        component.seasonSelected.subscribe((seasonKey) =>
            emittedSeasons.push(seasonKey)
        );
    });

    it('renders the series-level placeholder when no seasons are available', () => {
        setRequiredInputs({});
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain(
            'PORTALS.NO_EPISODES_AVAILABLE'
        );
        expect(
            fixture.nativeElement.querySelector('app-season-tabs')
        ).toBeNull();
    });

    it('renders the loading state instead of the placeholder while seasons are loading', () => {
        setRequiredInputs({}, true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '.loading-container mat-spinner'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).toBeNull();
    });

    it('auto-selects the first season, emits seasonSelected, and renders episodes without a click', () => {
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('1');
        expect(emittedSeasons).toEqual(['1']);
        expect(
            fixture.nativeElement.querySelectorAll('.episode-card').length
        ).toBe(1);
        expect(
            fixture.nativeElement.querySelectorAll('.season-tabs__pill').length
        ).toBe(2);
    });

    it('renders the season-level placeholder when the selected season has no episodes', () => {
        setRequiredInputs({ '1': [] });
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'PORTALS.SEASON_EMPTY'
        );
        expect(fixture.nativeElement.querySelector('.view-toggle')).toBeNull();
    });

    it('switches season via tab click and emits the lazy-load hook once per season', () => {
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        const pills = fixture.nativeElement.querySelectorAll(
            '.season-tabs__pill'
        );
        (pills[1] as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(emittedSeasons).toEqual(['1', '2']);
        expect(
            fixture.nativeElement.querySelector('[data-episode-id="201"]')
        ).not.toBeNull();
    });

    it('prefers the inline-playing episode season on auto-select', () => {
        fixture.componentRef.setInput('playingEpisodeId', 201);
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(emittedSeasons).toEqual(['2']);
    });

    it('prefers the most recently updated in-progress episode season over the first season', () => {
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [
                    201,
                    {
                        contentXtreamId: 201,
                        contentType: 'episode' as const,
                        positionSeconds: 500,
                        durationSeconds: 2700,
                        updatedAt: '2026-07-01T00:00:00.000Z',
                    },
                ],
            ])
        );
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
    });

    it('re-resolves a stale selection when the season set changes', () => {
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();
        expect(component.selectedSeason()).toBe('1');

        fixture.componentRef.setInput('seasons', {
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(emittedSeasons).toEqual(['1', '2']);
    });

    it('keeps the user selection when episode data mutates without key changes', () => {
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [],
        });
        fixture.detectChanges();

        const pills = fixture.nativeElement.querySelectorAll(
            '.season-tabs__pill'
        );
        (pills[1] as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(component.selectedSeason()).toBe('2');

        // Same keys, new object (e.g. TMDB overlay rebuild) — selection sticks
        fixture.componentRef.setInput('seasons', {
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(emittedSeasons).toEqual(['1', '2']);
    });

    it('uses a dropdown selector when there are more than six seasons', () => {
        const seasons: Record<string, XtreamSerieEpisode[]> = {};
        for (let index = 1; index <= 7; index++) {
            seasons[String(index)] = [
                createEpisode({ id: String(100 + index), season: index }),
            ];
        }
        setRequiredInputs(seasons);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="season-dropdown"]'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelectorAll('.season-tabs__pill').length
        ).toBe(0);
    });

    it('shows the back-to-playing chip only when the playing episode is in another season', () => {
        fixture.componentRef.setInput('playingEpisodeId', 101);
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="back-to-playing"]'
            )
        ).toBeNull();

        const pills = fixture.nativeElement.querySelectorAll(
            '.season-tabs__pill'
        );
        (pills[1] as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="back-to-playing"]'
            )
        ).not.toBeNull();
    });

    it('marks the inline-playing episode card', () => {
        fixture.componentRef.setInput('playingEpisodeId', 101);
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.episode-card--playing')
        ).not.toBeNull();
    });

    it('opens the episode info dialog and plays on the dialog play action', () => {
        dialogOpen.mockReturnValue({
            afterClosed: () => of(EPISODE_INFO_PLAY),
        });
        const played: XtreamSerieEpisode[] = [];
        setRequiredInputs({ '1': [createEpisode()] });
        component.episodeClicked.subscribe((episode) => played.push(episode));
        fixture.detectChanges();

        const infoButton = fixture.nativeElement.querySelector(
            '[data-testid="episode-info-button"]'
        ) as HTMLButtonElement;
        expect(infoButton).toBeTruthy();
        infoButton.click();

        expect(dialogOpen).toHaveBeenCalledTimes(1);
        const data = dialogOpen.mock.calls[0][1].data;
        expect(data.episodeLabel).toBe('S01E01');
        expect(data.plot).toBe('Pilot episode');
        expect(played.length).toBe(1);
    });

    it('hides the episode info button when the episode has no plot', () => {
        setRequiredInputs({
            '1': [createEpisode({ info: { duration: '45 min' } as never })],
        });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="episode-info-button"]'
            )
        ).toBeNull();
    });

    it('shows list thumbnails only for distinct episode images', () => {
        const withImages = (a: string, b: string) => ({
            '1': [
                createEpisode({ info: { movie_image: a } as never }),
                createEpisode({
                    id: '102',
                    episode_num: 2,
                    info: { movie_image: b } as never,
                }),
            ],
        });
        const query = (selector: string) =>
            fixture.nativeElement.querySelectorAll(selector).length;

        // Distinct stills → thumbnails replace the number square
        setRequiredInputs(withImages('still-1.jpg', 'still-2.jpg'));
        component.setViewMode('list');
        fixture.detectChanges();
        expect(component.listThumbnailsEnabled()).toBe(true);
        expect(query('.episode-list-item__thumb')).toBe(2);
        expect(query('.episode-list-item__number')).toBe(0);

        // Same poster on every episode → number squares stay
        setRequiredInputs(withImages('poster.jpg', 'poster.jpg'));
        fixture.detectChanges();
        expect(component.listThumbnailsEnabled()).toBe(false);
        expect(query('.episode-list-item__thumb')).toBe(0);
        expect(query('.episode-list-item__number')).toBe(2);
    });

    it('renders the season description for the selected season', () => {
        fixture.componentRef.setInput('seasonDescriptions', {
            '1': 'Season one overview',
        });
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="season-description"]'
            )?.textContent
        ).toContain('Season one overview');
    });
});
