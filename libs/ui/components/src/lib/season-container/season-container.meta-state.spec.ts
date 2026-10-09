import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SeasonDownloadCoordinator } from '@iptvnator/portal/shared/data-access';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
import { SeasonContainerComponent } from './season-container.component';

// Loading skeleton, full rows and bare rows of the season container,
// decided from the episode data (see episode-meta-state.util.ts).

const SERIES_POSTER = 'https://img.test/series.jpg';

function createEpisode(
    id: number,
    info: Record<string, unknown> = {}
): XtreamSerieEpisode {
    return {
        id: String(id),
        episode_num: id,
        title: `Episode ${id}`,
        container_extension: 'mp4',
        info,
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
    } as XtreamSerieEpisode;
}

/** A Stalker-like season: every "still" is the series poster, no plots. */
const bareSeason = () => ({
    '1': [1, 2, 3].map((id) =>
        createEpisode(id, { movie_image: SERIES_POSTER })
    ),
});

describe('SeasonContainerComponent metadata state', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;

    const setRequiredInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 20);
        fixture.componentRef.setInput('playlistId', 'playlist-1');
    };
    const all = (selector: string): HTMLElement[] =>
        Array.from(fixture.nativeElement.querySelectorAll(selector));

    beforeEach(async () => {
        localStorage.clear();
        await TestBed.configureTestingModule({
            imports: [
                NoopAnimationsModule,
                SeasonContainerComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: DownloadsService,
                    useValue: {
                        isAvailable: signal(false),
                        hasAuthoritativeDownloadList: signal(false),
                        hasLoadedDownloads: signal(false),
                        downloads: signal([]),
                    },
                },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                SeasonDownloadCoordinator,
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SeasonContainerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('seriesPosterUrl', SERIES_POSTER);
    });

    afterEach(() => localStorage.clear());

    it('renders bare rows without thumbnails and hides the grid toggle', () => {
        setRequiredInputs(bareSeason());
        fixture.detectChanges();

        expect(component.metaState()).toBe('bare');
        expect(all('app-episode-item.episode-item--bare')).toHaveLength(3);
        expect(all('.episode-item__thumb')).toHaveLength(0);
        expect(all('.view-toggle')).toHaveLength(0);
        expect(all('.episodes-list--bare')).toHaveLength(1);
    });

    it('keeps bare rows in list form even when grid was the saved view', () => {
        component.setViewMode('grid');
        setRequiredInputs(bareSeason());
        fixture.detectChanges();

        expect(component.effectiveViewMode()).toBe('list');
        expect(all('.episodes-grid')).toHaveLength(0);
        expect(all('app-episode-item.episode-list-item')).toHaveLength(3);
    });

    it('treats a still that repeats the season cover as missing', () => {
        fixture.componentRef.setInput('seasonPosters', {
            '1': 'https://img.test/season-1.jpg',
        });
        setRequiredInputs({
            '1': [
                createEpisode(1, {
                    movie_image: 'https://img.test/season-1.jpg',
                }),
                createEpisode(2, { movie_image: SERIES_POSTER }),
            ],
        });
        fixture.detectChanges();

        expect(component.metaState()).toBe('bare');
    });

    it('keeps full rows with a dimmed tile when only some stills are missing', () => {
        setRequiredInputs({
            '1': [
                createEpisode(1, { movie_image: 'https://img.test/e1.jpg' }),
                createEpisode(2, { movie_image: SERIES_POSTER }),
            ],
        });
        fixture.detectChanges();

        expect(component.metaState()).toBe('full');
        expect(all('.episode-item__thumb')).toHaveLength(2);
        expect(all('.episode-item__thumb--fallback')).toHaveLength(1);
        expect(all('.view-toggle')).toHaveLength(1);
    });

    it('shows one skeleton row per episode while the metadata loads, then the rows', () => {
        fixture.componentRef.setInput('metadataLoading', true);
        setRequiredInputs(bareSeason());
        fixture.detectChanges();

        // Not judged bare from the provider list alone.
        expect(component.metaState()).toBe('loading');
        expect(all('[data-testid="episode-skeleton"]')).toHaveLength(3);
        expect(all('app-episode-item')).toHaveLength(0);

        fixture.componentRef.setInput('seasons', {
            '1': [1, 2, 3].map((id) =>
                createEpisode(id, {
                    plot: `Plot ${id}`,
                    movie_image: `https://img.test/e${id}.jpg`,
                })
            ),
        });
        fixture.componentRef.setInput('metadataLoading', false);
        fixture.detectChanges();

        expect(component.metaState()).toBe('full');
        expect(all('[data-testid="episode-skeleton"]')).toHaveLength(0);
        expect(all('app-episode-item')).toHaveLength(3);
        expect(all('.episode-item__thumb--fallback')).toHaveLength(0);
    });

    it('falls back to bare only after the metadata answered with nothing', () => {
        fixture.componentRef.setInput('metadataLoading', true);
        setRequiredInputs(bareSeason());
        fixture.detectChanges();
        expect(component.metaState()).toBe('loading');

        fixture.componentRef.setInput('metadataLoading', false);
        fixture.detectChanges();
        expect(component.metaState()).toBe('bare');
    });

    it('follows the saved grid view with skeleton cards', () => {
        component.setViewMode('grid');
        fixture.componentRef.setInput('metadataLoading', true);
        setRequiredInputs(bareSeason());
        fixture.detectChanges();

        expect(all('app-episode-skeleton.episodes-grid')).toHaveLength(1);
        expect(all('.episode-skeleton--card')).toHaveLength(3);
    });
});
