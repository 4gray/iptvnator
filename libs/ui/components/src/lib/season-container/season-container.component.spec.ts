import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamSerieEpisode } from 'shared-interfaces';
import { DownloadsService } from 'services';
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
    });

    it('renders the series-level placeholder when no seasons are available', () => {
        setRequiredInputs({});
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain(
            'No episodes available'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'This series is listed by your provider, but no seasons or episodes are available to play.'
        );
        expect(fixture.nativeElement.querySelector('.season-card')).toBeNull();
    });

    it('renders the loading state instead of the placeholder while seasons are loading', () => {
        setRequiredInputs({}, true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.loading-container mat-spinner')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).toBeNull();
    });

    it('renders the season-level placeholder when the selected season has no episodes', () => {
        setRequiredInputs({ '1': [] });
        fixture.detectChanges();

        fixture.nativeElement.querySelector('.season-card').click();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'This season is empty'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'This season is listed by your provider, but no playable episodes are available.'
        );
        expect(fixture.nativeElement.querySelector('.view-toggle')).toBeNull();
    });

    it('renders season cards and episode cards when episodes exist', () => {
        const episode = createEpisode();

        setRequiredInputs({
            '1': [episode],
            '2': [],
        });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelectorAll('.season-card').length
        ).toBe(2);
        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).toBeNull();

        fixture.nativeElement.querySelector('.season-card').click();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelectorAll('.episode-card').length
        ).toBe(1);
        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).toBeNull();
    });

    it('clears a stale selected season when the input seasons change', () => {
        const episode = createEpisode();

        setRequiredInputs({ '1': [episode] });
        fixture.detectChanges();

        fixture.nativeElement.querySelector('.season-card').click();
        fixture.detectChanges();

        fixture.componentRef.setInput('seasons', { '2': [episode] });
        fixture.detectChanges();

        expect(component.selectedSeason).toBeUndefined();
        expect(
            fixture.nativeElement.querySelector('.season-card__number')
                ?.textContent
        ).toContain('2');
    });
});
