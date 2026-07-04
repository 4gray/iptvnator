import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
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
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SeasonContainerComponent);
        component = fixture.componentInstance;
        emittedSeasons = [];
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
